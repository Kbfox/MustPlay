import Foundation
import UIKit
import UserNotifications
import OneSignalFramework

/// OneSignal drives re-engagement (Journeys keyed off the tags below).
/// Exact release-day reminders stay on-device as local notifications.
final class NotificationManager {
    static let shared = NotificationManager()

    private init() {}

    private var oneSignalEnabled: Bool { !AppConfig.oneSignalAppID.isEmpty }

    func configure(launchOptions: [UIApplication.LaunchOptionsKey: Any]?) {
        guard oneSignalEnabled else {
            print("⚠️ ONESIGNAL_APP_ID is empty — fill Config/Secrets.xcconfig. Push is disabled.")
            return
        }
        #if DEBUG
        OneSignal.Debug.setLogLevel(.LL_VERBOSE)
        #endif
        OneSignal.initialize(AppConfig.oneSignalAppID, withLaunchOptions: launchOptions)
    }

    /// Ask at a meaningful moment (first game added), never on launch.
    func requestPermission() {
        if oneSignalEnabled {
            OneSignal.Notifications.requestPermission({ _ in }, fallbackToSettings: true)
        } else {
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
        }
    }

    /// Tags OneSignal Journeys can segment on:
    /// - `playing_count` > 0 and `playing_since` older than 30 days → "Finished it yet? Rate it."
    /// - `last_active` older than 7 days and `want_count` > 0 → "N games are still waiting."
    func syncTags(games: [BucketGame]) {
        guard oneSignalEnabled else { return }

        var counts: [GameStatus: Int] = [:]
        for game in games {
            counts[game.status, default: 0] += 1
        }
        let oldestPlaying = games
            .filter { $0.status == .playing }
            .compactMap(\.startedAt)
            .min()

        var tags: [String: String] = [
            "want_count": "\(counts[.wantToPlay] ?? 0)",
            "playing_count": "\(counts[.playing] ?? 0)",
            "completed_count": "\(counts[.completed] ?? 0)",
            "last_active": "\(Int(Date.now.timeIntervalSince1970))",
        ]
        if let oldestPlaying {
            tags["playing_since"] = "\(Int(oldestPlaying.timeIntervalSince1970))"
        } else {
            // Otherwise a stale timestamp would keep matching the "Playing 14d+" segment.
            OneSignal.User.removeTag("playing_since")
        }
        OneSignal.User.addTags(tags)
    }

    // MARK: Release-day reminders (local)

    func scheduleReleaseReminder(for game: BucketGame) {
        guard let releaseDate = game.releaseDate, releaseDate > .now else { return }

        var components = Calendar.current.dateComponents([.year, .month, .day], from: releaseDate)
        components.hour = 9

        let content = UNMutableNotificationContent()
        content.title = "\(game.name) is out today"
        content.body = "It's on your MustPlay list. Time to start?"
        content.sound = .default

        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        let request = UNNotificationRequest(identifier: reminderID(for: game), content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(request)
    }

    func cancelReleaseReminder(for game: BucketGame) {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [reminderID(for: game)])
    }

    private func reminderID(for game: BucketGame) -> String {
        "release-\(game.igdbID)"
    }
}
