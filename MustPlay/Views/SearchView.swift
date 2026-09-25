import SwiftUI
import SwiftData

struct SearchView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    @Environment(PurchaseManager.self) private var purchases
    @Query private var games: [BucketGame]

    @State private var query = ""
    @State private var results: [IGDBGame] = []
    @State private var isSearching = false
    @State private var errorMessage: String?
    @State private var showPaywall = false
    @State private var searchTask: Task<Void, Never>?
    @State private var addCount = 0

    private var savedIDs: Set<Int> { Set(games.map(\.igdbID)) }

    var body: some View {
        NavigationStack {
            List(results) { game in
                SearchResultRow(game: game, isSaved: savedIDs.contains(game.id)) {
                    add(game)
                }
            }
            .listStyle(.plain)
            .overlay { overlayContent }
            .searchable(
                text: $query,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Search any game"
            )
            .onChange(of: query) { _, newValue in
                scheduleSearch(newValue)
            }
            .navigationTitle("Add to your list")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .sheet(isPresented: $showPaywall) {
            PaywallSheet()
        }
        .sensoryFeedback(.success, trigger: addCount)
    }

    @ViewBuilder
    private var overlayContent: some View {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        if isSearching && results.isEmpty {
            ProgressView()
        } else if let errorMessage {
            ContentUnavailableView(
                "Search unavailable",
                systemImage: "wifi.exclamationmark",
                description: Text(errorMessage)
            )
        } else if results.isEmpty && trimmed.count < 2 {
            ContentUnavailableView(
                "Find your next game",
                systemImage: "magnifyingglass",
                description: Text("Search by title. Game data from IGDB.")
            )
        } else if results.isEmpty {
            ContentUnavailableView.search(text: query)
        }
    }

    private func scheduleSearch(_ text: String) {
        searchTask?.cancel()
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2 else {
            results = []
            errorMessage = nil
            return
        }

        searchTask = Task {
            // Debounce so we don't burn IGDB's 4 req/s on every keystroke.
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }

            isSearching = true
            defer { isSearching = false }

            do {
                let found = try await IGDBClient.shared.search(trimmed)
                guard !Task.isCancelled else { return }
                results = found
                errorMessage = nil
            } catch is CancellationError {
                // Superseded by a newer query.
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func add(_ game: IGDBGame) {
        guard !savedIDs.contains(game.id) else { return }
        guard purchases.canAddGame(currentCount: games.count) else {
            showPaywall = true
            return
        }

        let isFirstGame = games.isEmpty
        let nextOrder = (games.map(\.sortOrder).max() ?? -1) + 1
        let bucket = BucketGame(from: game, sortOrder: nextOrder)
        context.insert(bucket)
        addCount += 1

        NotificationManager.shared.scheduleReleaseReminder(for: bucket)
        // Ask for notifications when there's a concrete reason: first game, or one with a release date to wait for.
        if isFirstGame || bucket.isUpcoming {
            NotificationManager.shared.requestPermission()
        }
    }
}

private struct SearchResultRow: View {
    let game: IGDBGame
    let isSaved: Bool
    let onAdd: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            CoverImage(url: game.coverURL)
                .frame(width: 48, height: 64)

            VStack(alignment: .leading, spacing: 3) {
                Text(game.name)
                    .font(.body.weight(.medium))
                    .lineLimit(2)
                HStack(spacing: 6) {
                    if let date = game.releaseDate {
                        Text(date, format: .dateTime.year())
                    }
                    if !game.platformNames.isEmpty {
                        Text(game.platformNames.prefix(3).joined(separator: " · "))
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }

            Spacer()

            Image(systemName: isSaved ? "checkmark.circle.fill" : "plus.circle.fill")
                .font(.title2)
                .foregroundStyle(isSaved ? Color.green : Color.accentColor)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            if !isSaved { onAdd() }
        }
    }
}
