import Foundation
import Observation
import RevenueCat

/// Single source of truth for "is this user Pro". RevenueCat's `pro` entitlement gates the
/// free-list limit, share-card themes and future sync.
@MainActor
@Observable
final class PurchaseManager {
    static let shared = PurchaseManager()

    private(set) var isPro = false
    private(set) var isConfigured = false

    private init() {}

    func configure() {
        let key = AppConfig.revenueCatAPIKey
        guard !key.isEmpty else {
            print("⚠️ RC_API_KEY is empty — fill Config/Secrets.xcconfig. Purchases are disabled.")
            return
        }
        #if DEBUG
        Purchases.logLevel = .debug
        #endif
        Purchases.configure(withAPIKey: key)
        isConfigured = true
        Task { await observeCustomerInfo() }
    }

    private func observeCustomerInfo() async {
        for await info in Purchases.shared.customerInfoStream {
            apply(info)
        }
    }

    private func apply(_ info: CustomerInfo) {
        #if DEBUG
        if let debugOverride { isPro = debugOverride; return }
        #endif
        isPro = info.entitlements[AppConfig.proEntitlementID]?.isActive == true
    }

    func refresh() async {
        guard isConfigured else { return }
        if let info = try? await Purchases.shared.customerInfo() {
            apply(info)
        }
    }

    func restorePurchases() async throws {
        guard isConfigured else { return }
        apply(try await Purchases.shared.restorePurchases())
    }

    func canAddGame(currentCount: Int) -> Bool {
        isPro || currentCount < AppConfig.freeGameLimit
    }

    #if DEBUG
    /// While set, wins over RevenueCat's customer info so the free/Pro paths can be demoed
    /// even after a Test Store purchase. `nil` returns control to RevenueCat.
    private(set) var debugOverride: Bool?

    func debugSetPro(_ value: Bool?) {
        debugOverride = value
        if let value {
            isPro = value
        } else {
            Task { await refresh() }
        }
    }
    #endif
}
