import Foundation

// MARK: - Models

struct IGDBGame: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let name: String
    let cover: IGDBCover?
    let firstReleaseDate: TimeInterval?
    let platforms: [IGDBPlatform]?
    let summary: String?
    let totalRating: Double?
    let totalRatingCount: Int?

    enum CodingKeys: String, CodingKey {
        case id, name, cover, platforms, summary
        case firstReleaseDate = "first_release_date"
        case totalRating = "total_rating"
        case totalRatingCount = "total_rating_count"
    }

    var releaseDate: Date? {
        firstReleaseDate.map { Date(timeIntervalSince1970: $0) }
    }

    /// Short platform labels, de-duplicated, in IGDB order.
    var platformNames: [String] {
        var seen = Set<String>()
        return (platforms ?? []).compactMap { platform in
            guard let label = platform.abbreviation ?? platform.name, !seen.contains(label) else { return nil }
            seen.insert(label)
            return label
        }
    }

    var coverURL: URL? { IGDBImage.url(imageID: cover?.imageId, size: .coverBig) }
}

struct IGDBCover: Decodable, Hashable, Sendable {
    let imageId: String

    enum CodingKeys: String, CodingKey {
        case imageId = "image_id"
    }
}

struct IGDBPlatform: Decodable, Hashable, Sendable {
    let abbreviation: String?
    let name: String?
}

enum IGDBImageSize: String {
    case coverBig = "t_cover_big"       // 264×374
    case coverBig2x = "t_cover_big_2x"  // 528×748
    case hd = "t_720p"
}

enum IGDBImage {
    static func url(imageID: String?, size: IGDBImageSize) -> URL? {
        guard let imageID, !imageID.isEmpty else { return nil }
        return URL(string: "https://images.igdb.com/igdb/image/upload/\(size.rawValue)/\(imageID).jpg")
    }
}

// MARK: - Client

/// Talks to the Cloudflare Worker in `worker/`, which holds the Twitch credentials and forwards
/// Apicalypse queries to IGDB. The app never sees the client secret.
actor IGDBClient {
    static let shared = IGDBClient()

    enum IGDBError: LocalizedError {
        case notConfigured
        case http(Int)

        var errorDescription: String? {
            switch self {
            case .notConfigured:
                "Game search isn't configured yet. Set IGDB_PROXY_URL in Config/Secrets.xcconfig."
            case .http(let code):
                "Game database returned an error (\(code)). Try again in a moment."
            }
        }
    }

    private static let fields = "fields id,name,cover.image_id,first_release_date,platforms.abbreviation,platforms.name,summary,total_rating,total_rating_count;"

    private let session: URLSession
    private let decoder = JSONDecoder()

    init(session: URLSession = .shared) {
        self.session = session
    }

    func search(_ query: String, limit: Int = 20) async throws -> [IGDBGame] {
        let escaped = query
            .replacingOccurrences(of: "\\", with: "")
            .replacingOccurrences(of: "\"", with: "")
        // IGDB refuses `sort` alongside `search`, so over-fetch and rank locally.
        let body = """
        search "\(escaped)";
        \(Self.fields)
        where version_parent = null & parent_game = null;
        limit \(min(limit * 2, 50));
        """
        let results: [IGDBGame] = try await post("games", body: body)
        return Array(Self.ranked(results, query: escaped).prefix(limit))
    }

    /// Exact title matches first, then the games most people have rated. Ties keep IGDB's own
    /// relevance order, so an obscure 1995 "Hades" no longer outranks the 2020 one.
    static func ranked(_ games: [IGDBGame], query: String) -> [IGDBGame] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        return games.enumerated().sorted { lhs, rhs in
            let l = lhs.element, r = rhs.element
            let lExact = l.name.lowercased() == needle, rExact = r.name.lowercased() == needle
            if lExact != rExact { return lExact }
            let lCount = l.totalRatingCount ?? 0, rCount = r.totalRatingCount ?? 0
            if lCount != rCount { return lCount > rCount }
            return lhs.offset < rhs.offset
        }.map(\.element)
    }

    func upcoming(limit: Int = 20) async throws -> [IGDBGame] {
        let now = Int(Date.now.timeIntervalSince1970)
        let body = """
        \(Self.fields)
        where first_release_date > \(now) & version_parent = null & parent_game = null & hypes > 5;
        sort first_release_date asc;
        limit \(limit);
        """
        return try await post("games", body: body)
    }

    private func post<T: Decodable>(_ endpoint: String, body: String) async throws -> T {
        guard let base = AppConfig.igdbProxyURL else { throw IGDBError.notConfigured }

        var request = URLRequest(url: base.appending(path: "v4/\(endpoint)"))
        request.httpMethod = "POST"
        request.httpBody = Data(body.utf8)
        request.setValue("text/plain", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if !AppConfig.igdbAppKey.isEmpty {
            request.setValue(AppConfig.igdbAppKey, forHTTPHeaderField: "X-App-Key")
        }

        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard (200..<300).contains(status) else { throw IGDBError.http(status) }
        return try decoder.decode(T.self, from: data)
    }
}
