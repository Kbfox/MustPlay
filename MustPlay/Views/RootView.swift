import SwiftUI
import SwiftData

struct RootView: View {
    @Environment(PurchaseManager.self) private var purchases
    @Query(sort: \BucketGame.sortOrder) private var games: [BucketGame]

    @State private var filter: GameStatus?
    @State private var showSearch = false
    @State private var showSettings = false
    @State private var path: [BucketGame] = []

    private var counts: [GameStatus?: Int] {
        var result: [GameStatus?: Int] = [nil: games.count]
        for game in games {
            result[game.status, default: 0] += 1
        }
        return result
    }

    var body: some View {
        NavigationStack(path: $path) {
            BucketListView(filter: filter, path: $path, onAdd: { showSearch = true })
                // The system large title does not reliably reappear after popping an inline
                // detail view on iOS 26, so the heading is drawn as part of the top inset instead.
                .navigationTitle("")
                .navigationBarTitleDisplayMode(.inline)
                .safeAreaInset(edge: .top, spacing: 0) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("MustPlay")
                            .font(.largeTitle.bold())
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal)
                            .padding(.top, 4)
                            .accessibilityAddTraits(.isHeader)
                        FilterBar(selection: $filter, counts: counts)
                    }
                    .background(.bar)
                }
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            showSettings = true
                        } label: {
                            Image(systemName: "gearshape")
                        }
                    }
                    ToolbarItemGroup(placement: .topBarTrailing) {
                        if !games.isEmpty {
                            EditButton()
                        }
                        Button {
                            showSearch = true
                        } label: {
                            Image(systemName: "plus")
                        }
                    }
                }
        }
        .sheet(isPresented: $showSearch) {
            SearchView()
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
        .task {
            await purchases.refresh()
        }
        .onAppear {
            NotificationManager.shared.syncTags(games: games)
        }
        .onChange(of: games.map(\.statusRaw)) {
            NotificationManager.shared.syncTags(games: games)
        }
    }
}
