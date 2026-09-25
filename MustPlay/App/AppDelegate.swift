import UIKit

/// UIKit delegate only exists so OneSignal receives launch options.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        PurchaseManager.shared.configure()
        NotificationManager.shared.configure(launchOptions: launchOptions)
        return true
    }
}
