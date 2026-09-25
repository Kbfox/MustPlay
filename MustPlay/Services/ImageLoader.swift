import SwiftUI
import UIKit

/// Tiny in-memory cover cache on top of URLSession's disk cache. Also used to pre-load the cover
/// before rendering the share card, since ImageRenderer can't wait for AsyncImage.
actor ImageLoader {
    static let shared = ImageLoader()

    private let cache = NSCache<NSURL, UIImage>()
    private var inflight: [URL: Task<UIImage?, Never>] = [:]

    func image(for url: URL) async -> UIImage? {
        if let cached = cache.object(forKey: url as NSURL) {
            return cached
        }
        if let task = inflight[url] {
            return await task.value
        }

        let task = Task<UIImage?, Never> {
            guard let (data, _) = try? await URLSession.shared.data(from: url) else { return nil }
            return UIImage(data: data)
        }
        inflight[url] = task
        let image = await task.value
        inflight[url] = nil

        if let image {
            cache.setObject(image, forKey: url as NSURL)
        }
        return image
    }
}

struct CoverImage: View {
    let url: URL?
    var cornerRadius: CGFloat = 8

    @State private var image: UIImage?

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: cornerRadius)
                .fill(.quaternary)
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Image(systemName: "gamecontroller")
                    .foregroundStyle(.secondary)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
        .task(id: url) {
            guard let url else {
                image = nil
                return
            }
            image = await ImageLoader.shared.image(for: url)
        }
    }
}
