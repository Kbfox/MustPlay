import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct ShareCardSheet: View {
    let game: BucketGame
    var milestone: Int? = nil

    @Environment(PurchaseManager.self) private var purchases
    @Environment(\.dismiss) private var dismiss

    @State private var style: ShareCardStyle = .dark
    @State private var rendered: [ShareCardStyle: UIImage] = [:]
    @State private var cover: UIImage?
    @State private var coverLoaded = false
    @State private var failed = false
    @State private var showPaywall = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Group {
                    if let image = rendered[style] {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFit()
                            .clipShape(RoundedRectangle(cornerRadius: 20))
                            .shadow(color: .black.opacity(0.2), radius: 20, y: 10)
                            .padding(.horizontal, 40)
                            .id(style)
                            .transition(.opacity)
                    } else if failed {
                        ContentUnavailableView("Couldn't make the card", systemImage: "photo.badge.exclamationmark")
                    } else {
                        ProgressView("Making your card…")
                    }
                }
                .frame(maxHeight: .infinity)
                .animation(.easeInOut(duration: 0.2), value: style)

                stylePicker

                if let image = rendered[style] {
                    ShareLink(
                        item: SharePoster(image: image),
                        preview: SharePreview("I completed \(game.name)", image: Image(uiImage: image))
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
            .navigationTitle("Your card")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task {
                await render(style)
            }
            .sheet(isPresented: $showPaywall) {
                PaywallSheet()
            }
        }
    }

    private var stylePicker: some View {
        HStack(spacing: 10) {
            ForEach(ShareCardStyle.allCases) { option in
                let locked = option.requiresPro && !purchases.isPro
                let selected = option == style
                Button {
                    select(option)
                } label: {
                    VStack(spacing: 6) {
                        ZStack(alignment: .topTrailing) {
                            Image(systemName: option.systemImage)
                                .font(.title3)
                                .frame(width: 44, height: 44)
                                .background(selected ? Color.accentColor : Color(.secondarySystemBackground), in: Circle())
                                .foregroundStyle(selected ? .white : .primary)
                            if locked {
                                Image(systemName: "lock.fill")
                                    .font(.caption2.bold())
                                    .padding(4)
                                    .background(Color(.systemBackground), in: Circle())
                                    .offset(x: 4, y: -4)
                            }
                        }
                        Text(option.title)
                            .font(.caption)
                            .foregroundStyle(selected ? .primary : .secondary)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(locked ? "\(option.title), Pro" : option.title)
            }
        }
    }

    private func select(_ option: ShareCardStyle) {
        if option.requiresPro && !purchases.isPro {
            showPaywall = true
            return
        }
        style = option
        if rendered[option] == nil {
            Task { await render(option) }
        }
    }

    @MainActor
    private func render(_ style: ShareCardStyle) async {
        if !coverLoaded {
            if let url = game.largeCoverURL {
                cover = await ImageLoader.shared.image(for: url)
            }
            coverLoaded = true
        }

        let renderer = ImageRenderer(content: ShareCardView(game: game, cover: cover, style: style, milestone: milestone))
        renderer.scale = 1
        renderer.proposedSize = ProposedViewSize(ShareCardView.size)

        if let image = renderer.uiImage {
            rendered[style] = image
        } else {
            failed = true
        }
    }
}

/// PNG payload for ShareLink at full resolution.
struct SharePoster: Transferable {
    let image: UIImage

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .png) { poster in
            poster.image.pngData() ?? Data()
        }
    }
}
