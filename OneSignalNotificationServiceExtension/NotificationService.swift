import UserNotifications
import OneSignalExtension

/// Standard OneSignal service extension: enables rich media, confirmed delivery and
/// influenced-open tracking. Copied from OneSignal's iOS setup guide.
final class NotificationService: UNNotificationServiceExtension {
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var receivedRequest: UNNotificationRequest?
    private var bestAttemptContent: UNMutableNotificationContent?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        self.receivedRequest = request
        self.contentHandler = contentHandler
        self.bestAttemptContent = request.content.mutableCopy() as? UNMutableNotificationContent

        if let bestAttemptContent {
            OneSignalExtension.didReceiveNotificationExtensionRequest(
                request,
                with: bestAttemptContent,
                withContentHandler: contentHandler
            )
        } else {
            contentHandler(request.content)
        }
    }

    override func serviceExtensionTimeWillExpire() {
        guard let contentHandler, let bestAttemptContent, let receivedRequest else { return }
        OneSignalExtension.serviceExtensionTimeWillExpireRequest(receivedRequest, with: bestAttemptContent)
        contentHandler(bestAttemptContent)
    }
}
