import SwiftUI
import SwiftData

struct GameDetailView: View {
    @Bindable var game: BucketGame

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    @State private var showCompleteSheet = false
    @State private var showShareSheet = false
    @State private var showDeleteConfirm = false
    @State private var celebrating = false
    @State private var showWhatNext = false
    @State private var whatNextPending = false
    @State private var nextGame: BucketGame?

    @Query(sort: \BucketGame.sortOrder) private var allGames: [BucketGame]

    private var wantPool: [BucketGame] {
        allGames.filter { $0.status == .wantToPlay && !$0.isUpcoming && $0.igdbID != game.igdbID }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                CoverImage(url: game.largeCoverURL, cornerRadius: 16)
                    .frame(width: 200, height: 267)
                    .shadow(color: .black.opacity(0.25), radius: 16, y: 8)
                    .padding(.top, 8)

                VStack(spacing: 6) {
                    Text(game.name)
                        .font(.title2.bold())
                        .multilineTextAlignment(.center)
                    if !metaLine.isEmpty {
                        Text(metaLine)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }

                Picker("Status", selection: $game.status) {
                    ForEach(GameStatus.allCases) { status in
                        Text(status.title).tag(status)
                    }
                }
                .pickerStyle(.segmented)

                if let days = game.playingDays {
                    Label(days == 0 ? "Started today" : "Playing for \(days) day\(days == 1 ? "" : "s")", systemImage: "gamecontroller")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Color.accentColor)
                }

                if game.status == .completed {
                    completedCard
                } else {
                    Button {
                        showCompleteSheet = true
                    } label: {
                        Label("Mark as Completed", systemImage: "checkmark.seal.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                }

                if let summary = game.summary, !summary.isEmpty {
                    Text(summary)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding()
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    if game.status == .completed {
                        Button {
                            showCompleteSheet = true
                        } label: {
                            Label("Edit rating", systemImage: "star")
                        }
                    }
                    Button(role: .destructive) {
                        showDeleteConfirm = true
                    } label: {
                        Label("Remove from list", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .onChange(of: game.status) { _, newStatus in
            // Picking "Completed" in the segmented control goes through the same rating flow.
            if newStatus == .completed && game.rating == nil {
                showCompleteSheet = true
            }
        }
        .sheet(isPresented: $showCompleteSheet) {
            CompleteSheet(game: game) { isFirstCompletion in
                if isFirstCompletion { celebrate() }
            }
        }
        .sheet(isPresented: $showShareSheet, onDismiss: {
            // Right after a fresh completion, close the loop: pick the next game.
            if whatNextPending {
                whatNextPending = false
                if !wantPool.isEmpty { showWhatNext = true }
            }
        }) {
            ShareCardSheet(game: game, milestone: game.milestone(in: allGames))
        }
        .sheet(isPresented: $showWhatNext) {
            WhatNextSheet(pool: wantPool) { picked in
                nextGame = picked
            }
        }
        .navigationDestination(item: $nextGame) { next in
            GameDetailView(game: next)
        }
        .confirmationDialog("Remove \(game.name) from your list?", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("Remove", role: .destructive, action: remove)
        }
        .overlay {
            if celebrating {
                CelebrationOverlay(game: game, milestone: game.milestone(in: allGames)) {
                    finishCelebration()
                }
                .transition(.opacity)
            }
        }
        .sensoryFeedback(.success, trigger: celebrating) { _, isNow in isNow }
    }

    private var metaLine: String {
        var parts: [String] = []
        if let date = game.releaseDate {
            parts.append(date.formatted(.dateTime.year()))
        }
        if !game.platforms.isEmpty {
            parts.append(game.platforms.prefix(4).joined(separator: " · "))
        }
        return parts.joined(separator: "  ·  ")
    }

    private var completedCard: some View {
        VStack(spacing: 12) {
            if let rating = game.rating {
                StarsView(rating: rating, size: 28)
                if !game.note.isEmpty {
                    Text("“\(game.note)”")
                        .font(.body.italic())
                        .multilineTextAlignment(.center)
                }
                if let date = game.completedAt {
                    Text("Completed \(date, format: .dateTime.month(.abbreviated).day().year())")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Button {
                    showShareSheet = true
                } label: {
                    Label("Share your card", systemImage: "square.and.arrow.up")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            } else {
                Text("You finished it. How was it?")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button {
                    showCompleteSheet = true
                } label: {
                    Label("Rate it", systemImage: "star")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16))
    }

    private func celebrate() {
        withAnimation(.easeOut(duration: 0.25)) {
            celebrating = true
        }
    }

    private func finishCelebration() {
        withAnimation(.easeOut(duration: 0.3)) {
            celebrating = false
        }
        whatNextPending = true
        showShareSheet = true
    }

    private func remove() {
        NotificationManager.shared.cancelReleaseReminder(for: game)
        dismiss()
        // Let the pop animation finish before the model disappears from under this view.
        Task {
            try? await Task.sleep(for: .milliseconds(400))
            context.delete(game)
        }
    }
}

/// The completion ritual: dimmed backdrop, the cover slams in, a "COMPLETED" seal stamps onto it,
/// confetti bursts, then the poster hands off to the share sheet. Tapping anywhere skips ahead.
struct CelebrationOverlay: View {
    let game: BucketGame
    var milestone: Int? = nil
    var onFinish: () -> Void

    @State private var coverIn = false
    @State private var stamped = false
    @State private var textIn = false
    @State private var burstAt: Date?
    @State private var finished = false

    var body: some View {
        ZStack {
            Rectangle()
                .fill(.ultraThinMaterial)
                .overlay(Color.black.opacity(0.45))
                .ignoresSafeArea()

            if let burstAt {
                ConfettiView(startedAt: burstAt)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
            }

            VStack(spacing: 28) {
                ZStack {
                    CoverImage(url: game.largeCoverURL, cornerRadius: 18)
                        .frame(width: 220, height: 293)
                        .shadow(color: .black.opacity(0.5), radius: 30, y: 18)
                        .scaleEffect(coverIn ? 1 : 1.6)
                        .opacity(coverIn ? 1 : 0)
                        .rotation3DEffect(.degrees(coverIn ? 0 : 25), axis: (x: 1, y: 0, z: 0))

                    Text("COMPLETED")
                        .font(.system(size: 30, weight: .black, design: .rounded))
                        .tracking(3)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(.white, lineWidth: 4))
                        .rotationEffect(.degrees(-14))
                        .scaleEffect(stamped ? 1 : 3)
                        .opacity(stamped ? 1 : 0)
                        .offset(y: 90)
                }

                VStack(spacing: 6) {
                    Text(game.name)
                        .font(.title.bold())
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                    Text(milestoneLine)
                        .font(milestone == nil ? .subheadline : .headline)
                        .foregroundStyle(milestone == nil ? .white.opacity(0.75) : .yellow)
                }
                .foregroundStyle(.white)
                .opacity(textIn ? 1 : 0)
                .offset(y: textIn ? 0 : 12)
            }
            .padding(.horizontal, 32)
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: finish)
        .sensoryFeedback(.impact(weight: .heavy), trigger: stamped)
        .task {
            withAnimation(.spring(duration: 0.55, bounce: 0.35)) { coverIn = true }
            try? await Task.sleep(for: .milliseconds(450))
            withAnimation(.spring(duration: 0.3, bounce: 0.5)) { stamped = true }
            burstAt = .now
            try? await Task.sleep(for: .milliseconds(250))
            withAnimation(.easeOut(duration: 0.35)) { textIn = true }
            try? await Task.sleep(for: .milliseconds(2200))
            finish()
        }
    }

    private var milestoneLine: String {
        switch milestone {
        case 1: "Your first one. The list has begun."
        case .some(let n): "That's \(n) down. 🏆"
        case nil: "One more off the list."
        }
    }

    private func finish() {
        guard !finished else { return }
        finished = true
        onFinish()
    }
}

/// Lightweight confetti burst drawn with Canvas; no particle system dependencies.
private struct ConfettiView: View {
    let startedAt: Date

    private struct Piece {
        let angle: Double
        let speed: Double
        let spin: Double
        let size: CGFloat
        let color: Color
        let drift: Double
    }

    private static let colors: [Color] = [.yellow, .orange, .pink, .mint, .cyan, .white, Color.accentColor]

    private let pieces: [Piece] = {
        var rng = SystemRandomNumberGenerator()
        return (0..<90).map { _ in
            Piece(
                angle: Double.random(in: -Double.pi ... 0, using: &rng) * 0.9 - 0.05 * Double.pi,
                speed: Double.random(in: 520...980, using: &rng),
                spin: Double.random(in: -8...8, using: &rng),
                size: CGFloat.random(in: 6...12, using: &rng),
                color: colors.randomElement(using: &rng)!,
                drift: Double.random(in: -60...60, using: &rng)
            )
        }
    }()

    var body: some View {
        TimelineView(.animation) { timeline in
            let t = timeline.date.timeIntervalSince(startedAt)
            Canvas { context, size in
                guard t < 2.6 else { return }
                let origin = CGPoint(x: size.width / 2, y: size.height * 0.42)
                let gravity = 1400.0
                let fade = max(0, 1 - (t - 1.6) / 1.0)
                for piece in pieces {
                    let vx = cos(piece.angle) * piece.speed + piece.drift
                    let vy = sin(piece.angle) * piece.speed
                    let x = origin.x + vx * t
                    let y = origin.y + vy * t + 0.5 * gravity * t * t
                    var rect = CGRect(x: 0, y: 0, width: piece.size, height: piece.size * 0.6)
                    rect.origin = CGPoint(x: -rect.width / 2, y: -rect.height / 2)
                    var ctx = context
                    ctx.translateBy(x: x, y: y)
                    ctx.rotate(by: .radians(piece.spin * t))
                    ctx.opacity = fade
                    ctx.fill(Path(rect), with: .color(piece.color))
                }
            }
        }
    }
}
