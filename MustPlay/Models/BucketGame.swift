import Foundation
import SwiftData

enum GameStatus: String, Codable, CaseIterable, Identifiable {
    case wantToPlay
    case playing
    case completed

    var id: String { rawValue }

    var title: String {
        switch self {
        case .wantToPlay: "Want to Play"
        case .playing: "Playing"
        case .completed: "Completed"
        }
    }

    var shortTitle: String {
        switch self {
        case .wantToPlay: "Want"
        case .playing: "Playing"
        case .completed: "Done"
        }
    }

    var systemImage: String {
        switch self {
        case .wantToPlay: "bookmark"
        case .playing: "gamecontroller"
        case .completed: "checkmark.seal.fill"
        }
    }
}

/// One entry on the player's bucket list. `igdbID` is the IGDB game id and is unique per list.
@Model
final class BucketGame {
    @Attribute(.unique) var igdbID: Int
    var name: String
    var coverImageID: String?
    var releaseDate: Date?
    var platforms: [String]
    var summary: String?
    var statusRaw: String
    var rating: Int?
    var note: String
    var sortOrder: Int
    var addedAt: Date
    var startedAt: Date?
    var completedAt: Date?

    init(
        igdbID: Int,
        name: String,
        coverImageID: String?,
        releaseDate: Date?,
        platforms: [String],
        summary: String?,
        sortOrder: Int
    ) {
        self.igdbID = igdbID
        self.name = name
        self.coverImageID = coverImageID
        self.releaseDate = releaseDate
        self.platforms = platforms
        self.summary = summary
        self.sortOrder = sortOrder
        self.statusRaw = GameStatus.wantToPlay.rawValue
        self.note = ""
        self.addedAt = .now
    }

    convenience init(from game: IGDBGame, sortOrder: Int) {
        self.init(
            igdbID: game.id,
            name: game.name,
            coverImageID: game.cover?.imageId,
            releaseDate: game.releaseDate,
            platforms: game.platformNames,
            summary: game.summary,
            sortOrder: sortOrder
        )
    }

    var status: GameStatus {
        get { GameStatus(rawValue: statusRaw) ?? .wantToPlay }
        set {
            statusRaw = newValue.rawValue
            switch newValue {
            case .playing where startedAt == nil:
                startedAt = .now
            case .completed where completedAt == nil:
                completedAt = .now
            default:
                break
            }
        }
    }

    var coverURL: URL? { IGDBImage.url(imageID: coverImageID, size: .coverBig) }
    var largeCoverURL: URL? { IGDBImage.url(imageID: coverImageID, size: .coverBig2x) }

    var isUpcoming: Bool {
        guard let releaseDate else { return false }
        return releaseDate > .now
    }

    var platformLine: String { platforms.joined(separator: " · ") }

    /// Whole days since the game was marked Playing; nil when it isn't in progress.
    var playingDays: Int? {
        guard status == .playing, let startedAt else { return nil }
        return max(0, Calendar.current.dateComponents([.day], from: startedAt, to: .now).day ?? 0)
    }

    /// Completion counts that get a milestone card. Small numbers matter most early on.
    static let milestones: Set<Int> = [1, 5, 10, 25, 50, 100]

    /// 1-based position of this game among all completions, ordered by completion time.
    func completionIndex(in games: [BucketGame]) -> Int? {
        guard status == .completed, let completedAt else { return nil }
        let earlier = games.filter { other in
            other.status == .completed && (other.completedAt ?? .distantFuture) < completedAt
        }
        return earlier.count + 1
    }

    /// The milestone number if this completion hit one.
    func milestone(in games: [BucketGame]) -> Int? {
        guard let index = completionIndex(in: games), Self.milestones.contains(index) else { return nil }
        return index
    }
}
