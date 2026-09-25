import SwiftUI
import SwiftData

/// "What next?" — picks one game from the Want pile so the player stops scrolling and starts playing.
/// A mood narrows the pool; the shuffle animation gives the pick a little weight.
enum PickMood: String, CaseIterable, Identifiable {
    case surprise, waiting, classic, fresh

    var id: String { rawValue }

    var title: String {
        switch self {
        case .surprise: "Surprise me"
        case .waiting: "Waiting longest"
        case .classic: "A classic"
        case .fresh: "Something new"
        }
    }

    var systemImage: String {
        switch self {
        case .surprise: "dice.fill"
        case .waiting: "hourglass"
        case .classic: "arcade.stick"
        case .fresh: "sparkles"
        }
    }

    /// Why this game was chosen; shown under the pick.
    func reason(for game: BucketGame) -> String {
        switch self {
        case .surprise:
            return "The dice have spoken."
        case .waiting:
            let days = max(1, Calendar.current.dateComponents([.day], from: game.addedAt, to: .now).day ?? 1)
            return days == 1 ? "Added yesterday. No time like the present." : "On your list for \(days) days. Its turn."
        case .classic:
            if let year = game.releaseDate.map({ Calendar.current.component(.year, from: $0) }) {
                return "From \(year). Still waiting for you."
            }
            return "An oldie from your list."
        case .fresh:
            if let year = game.releaseDate.map({ Calendar.current.component(.year, from: $0) }) {
                return "Released \(year). Ink's barely dry."
            }
            return "The newest thing on your list."
        }
    }

    /// Candidates for this mood, best first. Falls back to the whole pool if the mood matches nothing.
    func candidates(from pool: [BucketGame]) -> [BucketGame] {
        let released = pool.filter { !$0.isUpcoming }
        switch self {
        case .surprise:
            return released.shuffled()
        case .waiting:
            return released.sorted { $0.addedAt < $1.addedAt }
        case .classic:
            let cutoff = Calendar.current.date(byAdding: .year, value: -12, to: .now)!
            let old = released.filter { ($0.releaseDate ?? .distantFuture) < cutoff }.sorted { ($0.releaseDate ?? .now) < ($1.releaseDate ?? .now) }
            return old.isEmpty ? released.shuffled() : old
        case .fresh:
            return released.sorted { ($0.releaseDate ?? .distantPast) > ($1.releaseDate ?? .distantPast) }
        }
    }
}

struct WhatNextSheet: View {
    let pool: [BucketGame]
    /// Called with the chosen game after "Start playing"; the caller navigates to it.
    var onStart: (BucketGame) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var mood: PickMood = .surprise
    @State private var pick: BucketGame?
    @State private var shuffling = false
    @State private var shuffleFace: BucketGame?
    @State private var lastPickID: Int?
    @State private var rollCount = 0

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                moodPicker
                    .padding(.top, 4)

                Spacer(minLength: 0)

                ZStack {
                    if let face = shuffleFace ?? pick {
                        CoverImage(url: face.largeCoverURL, cornerRadius: 20)
                            .frame(width: 210, height: 280)
                            .shadow(color: .black.opacity(0.28), radius: 24, y: 14)
                            .id(face.igdbID)
                            .transition(.asymmetric(
                                insertion: .scale(scale: 0.85).combined(with: .opacity),
                                removal: .opacity
                            ))
                    } else {
                        RoundedRectangle(cornerRadius: 20)
                            .fill(Color(.secondarySystemBackground))
                            .frame(width: 210, height: 280)
                            .overlay {
                                Image(systemName: "questionmark")
                                    .font(.system(size: 64, weight: .bold))
                                    .foregroundStyle(.tertiary)
                            }
                    }
                }
                .animation(.spring(duration: 0.35, bounce: 0.25), value: (shuffleFace ?? pick)?.igdbID)

                VStack(spacing: 8) {
                    if let pick, !shuffling {
                        Text(pick.name)
                            .font(.title2.bold())
                            .multilineTextAlignment(.center)
                            .lineLimit(2)
                        Text(mood.reason(for: pick))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    } else if shuffling {
                        Text("Picking…")
                            .font(.title2.bold())
                            .foregroundStyle(.secondary)
                    } else {
                        Text("Can't decide?")
                            .font(.title2.bold())
                        Text("\(pool.count) games are waiting. Let one pick you.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(minHeight: 70)
                .padding(.horizontal, 32)
                .animation(.easeInOut(duration: 0.2), value: shuffling)

                Spacer(minLength: 0)

                VStack(spacing: 12) {
                    if let pick, !shuffling {
                        Button {
                            pick.status = .playing
                            dismiss()
                            onStart(pick)
                        } label: {
                            Label("Start playing", systemImage: "play.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        Button {
                            roll()
                        } label: {
                            Text("Roll again")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                    } else {
                        Button {
                            roll()
                        } label: {
                            Label("Pick for me", systemImage: "dice.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .disabled(shuffling)
                    }
                }
                .padding(.horizontal)
            }
            .padding(.bottom)
            .navigationTitle("What next?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .sensoryFeedback(.success, trigger: rollCount)
        }
        .presentationDetents([.large])
    }

    private var moodPicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(PickMood.allCases) { option in
                    let selected = option == mood
                    Button {
                        mood = option
                        if pick != nil { roll() }
                    } label: {
                        Label(option.title, systemImage: option.systemImage)
                            .font(.subheadline.weight(.medium))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(selected ? Color.accentColor : Color(.secondarySystemBackground), in: Capsule())
                            .foregroundStyle(selected ? .white : .primary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal)
        }
    }

    private func roll() {
        guard !shuffling else { return }
        var candidates = mood.candidates(from: pool)
        if candidates.count > 1, let lastPickID {
            candidates.removeAll { $0.igdbID == lastPickID }
        }
        guard let winner = mood == .surprise ? candidates.first : candidates.first else { return }

        shuffling = true
        pick = nil
        let faces = pool.shuffled().prefix(8)
        Task { @MainActor in
            var delay: UInt64 = 70
            for face in faces {
                shuffleFace = face
                try? await Task.sleep(for: .milliseconds(delay))
                delay += 25
            }
            shuffleFace = nil
            pick = winner
            lastPickID = winner.igdbID
            shuffling = false
            rollCount += 1
        }
    }
}
