import Foundation

/// Values come from Config/Secrets.xcconfig → Info.plist. Empty string means "not configured yet";
/// every service degrades gracefully so the simulator build works before keys exist.
enum AppConfig {
    static let revenueCatAPIKey = infoValue("RC_API_KEY")
    static let oneSignalAppID = infoValue("ONESIGNAL_APP_ID")
    static let igdbProxyURL = URL(string: infoValue("IGDB_PROXY_URL"))
    static let igdbAppKey = infoValue("IGDB_APP_KEY")

    static let proEntitlementID = "pro"
    static let freeGameLimit = 10

    static let igdbAttributionURL = URL(string: "https://www.igdb.com")!

    private static func infoValue(_ key: String) -> String {
        let raw = Bundle.main.object(forInfoDictionaryKey: key) as? String ?? ""
        // An unfilled xcconfig variable expands to an empty string; a stale placeholder should count as empty too.
        return raw.contains("YOUR-SUBDOMAIN") ? "" : raw
    }
}
