import SwiftUI
import SwiftData

struct BucketListView: View {
    let filter: GameStatus?
    @Binding var path: [BucketGame]
    let onAdd: () -> Void

    @Environment(\.modelContext) private var context
    @Query(sort: \BucketGame.sortOrder) private var allGames: [BucketGame]

    @State private var showWhatNext = false

    /// Games eligible for "What next?": the Want pile, released games only.
    private var wantPool: [BucketGame] {
        allGames.filter { $0.status == .wantToPlay && !$0.isUpcoming }
    }

    private var games: [BucketGame] {
        guard let filter else { return allGames }
        return allGames.filter { $0.status == filter }
    }

    var body: some View {
        Group {
            if games.isEmpty {
                emptyState
            } else {
                list
            }
        }
        .navigationDestination(for: BucketGame.self) { game in
            GameDetailView(game: game)
        }
        .sheet(isPresented: $showWhatNext) {
            WhatNextSheet(pool: wantPool) { game in
                path.append(game)
            }
        }
    }

    private var list: some View {
        List {
            if wantPool.count >= 2 && (filter == nil || filter == .wantToPlay) {
                whatNextCard
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 4, trailing: 16))
            }
            ForEach(games) { game in
                NavigationLink(value: game) {
                    GameRowView(game: game)
                }
            }
            .onMove(perform: move)
            .onDelete(perform: delete)
        }
        .listStyle(.plain)
    }

    private var whatNextCard: some View {
        Button {
            showWhatNext = true
        } label: {
            HStack(spacing: 14) {
                Image(systemName: "dice.fill")
                    .font(.title2)
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text("What next?")
                        .font(.headline)
                    Text("\(wantPool.count) waiting. Let one pick you.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(14)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label(emptyTitle, systemImage: filter?.systemImage ?? "list.star")
        } description: {
            Text(emptyDescription)
        } actions: {
            if filter == nil || filter == .wantToPlay {
                Button("Add a game", action: onAdd)
                    .buttonStyle(.borderedProminent)
            }
        }
    }

    private var emptyTitle: String {
        switch filter {
        case nil: "Your bucket list is empty"
        case .wantToPlay: "Nothing queued"
        case .playing: "Not playing anything"
        case .completed: "No completions yet"
        }
    }

    private var emptyDescription: String {
        switch filter {
        case nil: "Add the games you want to play before you die. Or, you know, before the next one comes out."
        case .wantToPlay: "Every game on your list has been started. Add another?"
        case .playing: "Pick something from your list and mark it as Playing."
        case .completed: "Finish a game, rate it, and it shows up here."
        }
    }

    private func move(from source: IndexSet, to destination: Int) {
        var reordered = games
        reordered.move(fromOffsets: source, toOffset: destination)
        // Reuse the existing sort slots so games hidden by the filter keep their positions.
        let slots = games.map(\.sortOrder).sorted()
        for (index, game) in reordered.enumerated() {
            game.sortOrder = slots[index]
        }
    }

    private func delete(at offsets: IndexSet) {
        for index in offsets {
            let game = games[index]
            NotificationManager.shared.cancelReleaseReminder(for: game)
            context.delete(game)
        }
    }
}
