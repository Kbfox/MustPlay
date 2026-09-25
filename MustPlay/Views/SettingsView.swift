import SwiftUI
import SwiftData

struct SettingsView: View {
    @Environment(PurchaseManager.self) private var purchases
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context

    @State private var showPaywall = false
    @State private var restoreMessage: String?
    @State private var seeding = false

    var body: some View {
        NavigationStack {
            Form {
                Section("MustPlay Pro") {
                    LabeledContent("Status", value: purchases.isPro ? "Pro" : "Free")
                    if !purchases.isPro {
                        Button("Go Pro") { showPaywall = true }
                    }
                    Button("Restore Purchases") {
                        Task { await restore() }
                    }
                    .disabled(!purchases.isConfigured)
                    if let restoreMessage {
                        Text(restoreMessage)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Notifications") {
                    Button("Enable reminders") {
                        NotificationManager.shared.requestPermission()
                    }
                    Text("Release-day reminders for games on your list, and a nudge when something has been \"Playing\" for a while.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("About") {
                    // IGDB attribution is a condition of using their data.
                    Link(destination: AppConfig.igdbAttributionURL) {
                        LabeledContent("Game data", value: "IGDB")
                    }
                    LabeledContent("Version", value: appVersion)
                }

                #if DEBUG
                Section("Debug") {
                    Toggle("Simulate Pro", isOn: Binding(
                        get: { purchases.isPro },
                        set: { purchases.debugSetPro($0) }
                    ))
                    if purchases.debugOverride != nil {
                        Button("Clear Pro override (use RevenueCat)") { purchases.debugSetPro(nil) }
                    }
                    Button("Show paywall") { showPaywall = true }
                    LabeledContent("RevenueCat", value: purchases.isConfigured ? "configured" : "no key")
                    LabeledContent("OneSignal", value: AppConfig.oneSignalAppID.isEmpty ? "no key" : "configured")
                    LabeledContent("IGDB proxy", value: AppConfig.igdbProxyURL?.host() ?? "not set")
                    Button(seeding ? "Adding sample games…" : "Fill list to free limit") {
                        Task { await seedSampleGames() }
                    }
                    .disabled(seeding)
                }
                #endif
            }
            .navigationTitle("Settings")
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
    }

    private var appVersion: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
        return "\(version) (\(build))"
    }

    #if DEBUG
    /// Tops the list up to the free limit so the paywall path and demo videos are one tap away.
    @MainActor
    private func seedSampleGames() async {
        seeding = true
        defer { seeding = false }
        let titles = ["The Legend of Zelda: Breath of the Wild", "Elden Ring", "Portal 2", "Hollow Knight",
                      "Celeste", "Outer Wilds", "Disco Elysium", "Stardew Valley", "Half-Life 2", "Undertale",
                      "Baldur's Gate 3", "Chrono Trigger"]
        let existing = try? context.fetch(FetchDescriptor<BucketGame>())
        var known = Set((existing ?? []).map(\.igdbID))
        var order = ((existing ?? []).map(\.sortOrder).max() ?? -1) + 1
        var added = 0
        let room = max(0, AppConfig.freeGameLimit - (existing?.count ?? 0))
        for title in titles where added < room {
            guard let hit = try? await IGDBClient.shared.search(title, limit: 1).first, !known.contains(hit.id) else { continue }
            context.insert(BucketGame(from: hit, sortOrder: order))
            known.insert(hit.id)
            order += 1
            added += 1
        }
    }
    #endif

    private func restore() async {
        do {
            try await purchases.restorePurchases()
            restoreMessage = purchases.isPro ? "Pro restored." : "No purchases found for this Apple ID."
        } catch {
            restoreMessage = error.localizedDescription
        }
    }
}
