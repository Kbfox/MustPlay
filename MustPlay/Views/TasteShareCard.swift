import SwiftUI
import UIKit

/// 1080×1920 taste-profile poster, rendered off-screen by ImageRenderer like `ShareCardView`.
/// Everything is synchronous: cover images are preloaded by `TasteShareSheet`.
struct TasteShareCard: View {
    let summary: String
    let tags: [ScoutTasteTag]
    /// Covers of the games the profile was read from (up to three).
    let covers: [UIImage]

    static let size = ShareCardView.size
    private static let brand = ShareCardView.brand

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Self.brand, Color(red: 0.30, green: 0.16, blue: 0.62), Color(red: 0.08, green: 0.06, blue: 0.16)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Circle()
                .fill(.white.opacity(0.08))
                .frame(width: 1400, height: 1400)
                .offset(x: 420, y: -820)

            VStack(spacing: 0) {
                Spacer(minLength: 0)

                if !covers.isEmpty {
                    coverFan
                        .padding(.bottom, 80)
                }

                Text("MY GAMING TASTE")
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .tracking(8)
                    .foregroundStyle(.white.opacity(0.7))
                    .padding(.bottom, 28)

                Text(summary)
                    .font(.system(size: 62, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .lineSpacing(6)
                    .minimumScaleFactor(0.6)
                    .lineLimit(4)
                    // ImageRenderer proposes the full poster width to the stack; pin the wrap width explicitly.
                    .frame(width: Self.size.width - 240)
                    .padding(.bottom, 60)

                tagCloud
                    .frame(width: Self.size.width - 200)

                Spacer(minLength: 0)

                HStack(spacing: 14) {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 34))
                    Text("MustPlay")
                        .font(.system(size: 38, weight: .bold, design: .rounded))
                    Text("· taste analysis by Qloo")
                        .font(.system(size: 30, weight: .medium))
                        .opacity(0.8)
                }
                .foregroundStyle(.white.opacity(0.9))
                .padding(.bottom, 90)
            }
        }
        .frame(width: Self.size.width, height: Self.size.height)
    }

    private var coverFan: some View {
        HStack(spacing: -70) {
            ForEach(Array(covers.prefix(3).enumerated()), id: \.offset) { index, image in
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 300, height: 400)
                    .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).stroke(.white.opacity(0.35), lineWidth: 4))
                    .shadow(color: .black.opacity(0.45), radius: 40, y: 24)
                    .rotationEffect(.degrees(Double(index - 1) * 9))
                    .offset(y: index == 1 ? -30 : 0)
                    .zIndex(index == 1 ? 1 : 0)
            }
        }
    }

    private var tagCloud: some View {
        let rows = stride(from: 0, to: tags.count, by: 2).map { Array(tags[$0..<min($0 + 2, tags.count)]) }
        return VStack(spacing: 22) {
            ForEach(rows.indices, id: \.self) { index in
                HStack(spacing: 22) {
                    ForEach(rows[index], id: \.name) { tag in
                        Text(tag.name)
                            .font(.system(size: 36 + CGFloat(tag.affinity) * 14, weight: .semibold, design: .rounded))
                            .padding(.horizontal, 36)
                            .padding(.vertical, 18)
                            .background(.white.opacity(0.16 + tag.affinity * 0.2), in: Capsule())
                            .foregroundStyle(.white)
                    }
                }
            }
        }
    }
}

/// Preview + share for the taste poster. Mirrors `ShareCardSheet` without the style picker.
struct TasteShareSheet: View {
    let summary: String
    let tags: [ScoutTasteTag]
    let coverURLs: [URL]

    @Environment(\.dismiss) private var dismiss
    @State private var rendered: UIImage?
    @State private var failed = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Group {
                    if let rendered {
                        Image(uiImage: rendered)
                            .resizable()
                            .scaledToFit()
                            .clipShape(RoundedRectangle(cornerRadius: 20))
                            .shadow(color: .black.opacity(0.2), radius: 20, y: 10)
                            .padding(.horizontal, 40)
                    } else if failed {
                        ContentUnavailableView("Couldn't make the card", systemImage: "photo.badge.exclamationmark")
                    } else {
                        ProgressView("Making your card…")
                    }
                }
                .frame(maxHeight: .infinity)

                if let rendered {
                    ShareLink(
                        item: SharePoster(image: rendered),
                        preview: SharePreview("My gaming taste", image: Image(uiImage: rendered))
                    ) {
                        Label("Share", systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .padding(.horizontal)
                }
            }
            .padding(.vertical)
            .navigationTitle("Your taste")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task { await render() }
        }
    }

    @MainActor
    private func render() async {
        var covers: [UIImage] = []
        for url in coverURLs.prefix(3) {
            if let image = await ImageLoader.shared.image(for: url) { covers.append(image) }
        }
        let renderer = ImageRenderer(content: TasteShareCard(summary: summary, tags: tags, covers: covers))
        renderer.scale = 1
        renderer.proposedSize = ProposedViewSize(TasteShareCard.size)
        if let image = renderer.uiImage {
            rendered = image
        } else {
            failed = true
        }
    }
}
