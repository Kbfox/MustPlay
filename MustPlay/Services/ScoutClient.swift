import Foundation

// MARK: - Wire format (mirrors worker/src/agent.ts)

enum ScoutIntent: String, Codable {
    case pick, discover, deepcuts, taste, postcredits, whynot, chat
}

struct ScoutRequest: Encodable {
    struct Message: Encodable {
        let role: String
        let content: String
    }
    struct LibraryGame: Encodable {
        let igdb_id: Int
        let name: String
        let status: String
        let rating: Int?
        let year: Int?
        let platforms: [String]
        let qloo_id: String?
    }

    var intent: ScoutIntent?
    var messages: [Message]
    var library: [LibraryGame]
    var focus_igdb_id: Int?
}

struct ScoutGameCard: Decodable, Identifiable, Hashable {
    let igdb_id: Int?
    let name: String
    let cover_image_id: String?
    let year: Int?
    let platforms: [String]?
    let reason: String
    let in_library: Bool
    let qloo_id: String?
    let affinity: Double?
    let tags: [String]
    let image_url: String?
    /// Loved games this result is closest to (Qloo explainability), strongest first. Absent on older Worker responses.
    let because: [String]?
    /// Qloo popularity percentile, 0–1. Absent on older Worker responses.
    let popularity: Double?

    var id: String { "\(igdb_id ?? 0)-\(name)" }
    /// IGDB cover when we have one, else Qloo's artwork.
    var coverURL: URL? { IGDBImage.url(imageID: cover_image_id, size: .coverBig) ?? image_url.flatMap(URL.init(string:)) }
    /// Below the 92nd popularity percentile counts as a find rather than a household name.
    var isUnderTheRadar: Bool { popularity.map { $0 < 0.92 } ?? false }
}

struct ScoutTasteTag: Decodable, Hashable {
    let name: String
    let affinity: Double
}

struct ScoutCrossCard: Decodable, Identifiable, Hashable {
    let type: String
    let name: String
    let year: Int?
    let reason: String
    let tags: [String]
    let image_url: String?

    var id: String { "\(type)-\(name)" }
    var imageURL: URL? { image_url.flatMap(URL.init(string:)) }

    var systemImage: String {
        switch type {
        case "movie": "film"
        case "tv_show": "tv"
        case "artist": "music.note"
        case "book": "book"
        case "podcast": "mic"
        default: "sparkles"
        }
    }

    var typeLabel: String {
        switch type {
        case "movie": "Film"
        case "tv_show": "Series"
        case "artist": "Music"
        case "book": "Book"
        case "podcast": "Podcast"
        default: type.capitalized
        }
    }
}

enum ScoutEvent: Decodable {
    case status(String)
    case games(title: String?, items: [ScoutGameCard])
    case taste(summary: String, tags: [ScoutTasteTag])
    case crossover([ScoutCrossCard])
    case resolved([Int: String])
    case message(String)
    case error(String)
    case done

    private enum CodingKeys: String, CodingKey {
        case type, text, title, items, summary, tags, map
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .type) {
        case "status": self = .status(try c.decode(String.self, forKey: .text))
        case "games": self = .games(title: try c.decodeIfPresent(String.self, forKey: .title), items: try c.decode([ScoutGameCard].self, forKey: .items))
        case "taste": self = .taste(summary: try c.decode(String.self, forKey: .summary), tags: try c.decode([ScoutTasteTag].self, forKey: .tags))
        case "crossover": self = .crossover(try c.decode([ScoutCrossCard].self, forKey: .items))
        case "resolved":
            let raw = try c.decode([String: String].self, forKey: .map)
            var map: [Int: String] = [:]
            for (k, v) in raw { if let id = Int(k) { map[id] = v } }
            self = .resolved(map)
        case "message": self = .message(try c.decode(String.self, forKey: .text))
        case "error": self = .error(try c.decode(String.self, forKey: .text))
        default: self = .done
        }
    }
}

// MARK: - Client

/// Streams `POST /agent` (server-sent events) from the same Worker that proxies IGDB.
enum ScoutClient {
    enum ScoutError: LocalizedError {
        case notConfigured
        case http(Int)

        var errorDescription: String? {
            switch self {
            case .notConfigured: "Scout isn't configured yet. Set IGDB_PROXY_URL in Config/Secrets.xcconfig."
            case .http(let code): "Scout is unavailable right now (\(code)). Try again in a moment."
            }
        }
    }

    static func library(from games: [BucketGame]) -> [ScoutRequest.LibraryGame] {
        games.prefix(200).map { game in
            ScoutRequest.LibraryGame(
                igdb_id: game.igdbID,
                name: game.name,
                status: game.statusRaw,
                rating: game.rating,
                year: game.releaseDate.map { Calendar.current.component(.year, from: $0) },
                platforms: Array(game.platforms.prefix(4)),
                qloo_id: game.qlooEntityID
            )
        }
    }

    static func stream(_ body: ScoutRequest) -> AsyncThrowingStream<ScoutEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    guard let base = AppConfig.igdbProxyURL else { throw ScoutError.notConfigured }
                    var request = URLRequest(url: base.appending(path: "agent"))
                    request.httpMethod = "POST"
                    request.timeoutInterval = 120
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    if !AppConfig.igdbAppKey.isEmpty {
                        request.setValue(AppConfig.igdbAppKey, forHTTPHeaderField: "X-App-Key")
                    }
                    request.httpBody = try JSONEncoder().encode(body)

                    let (bytes, response) = try await URLSession.shared.bytes(for: request)
                    let status = (response as? HTTPURLResponse)?.statusCode ?? -1
                    guard status == 200 else { throw ScoutError.http(status) }

                    let decoder = JSONDecoder()
                    for try await line in bytes.lines {
                        guard line.hasPrefix("data: "), let data = line.dropFirst(6).data(using: .utf8) else { continue }
                        let event = try decoder.decode(ScoutEvent.self, from: data)
                        continuation.yield(event)
                        if case .done = event { break }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
