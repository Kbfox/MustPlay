import SwiftUI
import RevenueCat
import RevenueCatUI

/// The real paywall is designed in the RevenueCat dashboard (Paywalls V2) and rendered by
/// `PaywallView`. Until RC_API_KEY is set, a placeholder shows the feature list so the free-limit
/// flow can be exercised in the simulator.
struct PaywallSheet: View {
    @Environment(PurchaseManager.self) private var purchases
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        if purchases.isConfigured {
            PaywallView(displayCloseButton: true)
                .onPurchaseCompleted { _ in dismiss() }
                .onRestoreCompleted { _ in dismiss() }
        } else {
            placeholder
        }
    }

    private var placeholder: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 20) {
                Text("MustPlay Pro")
                    .font(.largeTitle.bold())

                VStack(alignment: .leading, spacing: 12) {
                    FeatureRow(icon: "infinity", text: "Unlimited games on your list")
                    FeatureRow(icon: "paintpalette", text: "Poster, Retro and Minimal share cards")
                    FeatureRow(icon: "heart", text: "Support an indie, one-person app")
                }

                Text("The free list holds \(AppConfig.freeGameLimit) games.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                Spacer()

                #if DEBUG
                Text("RevenueCat isn't configured (RC_API_KEY is empty). This placeholder is replaced by the dashboard paywall once the key is set.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("Simulate Pro (debug only)") {
                    purchases.debugSetPro(true)
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                #endif
            }
            .padding()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
    }
}

private struct FeatureRow: View {
    let icon: String
    let text: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(Color.accentColor)
                .frame(width: 28)
            Text(text)
        }
    }
}
