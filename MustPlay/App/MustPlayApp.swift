import SwiftUI
import SwiftData

@main
struct MustPlayApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(PurchaseManager.shared)
        }
        .modelContainer(for: BucketGame.self)
    }
}
