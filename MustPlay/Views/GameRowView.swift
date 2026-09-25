import SwiftUI

struct GameRowView: View {
    let game: BucketGame

    var body: some View {
        HStack(spacing: 12) {
            CoverImage(url: game.coverURL)
                .frame(width: 56, height: 75)

            VStack(alignment: .leading, spacing: 4) {
                Text(game.name)
                    .font(.headline)
                    .lineLimit(2)

                if !game.platforms.isEmpty {
                    Text(game.platformLine)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                HStack(spacing: 8) {
                    StatusBadge(status: game.status)

                    if game.status == .completed, let rating = game.rating {
                        StarsView(rating: rating, size: 10)
                    } else if let days = game.playingDays {
                        Text(days == 0 ? "Started today" : "Day \(days + 1)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    } else if game.isUpcoming, let date = game.releaseDate {
                        Text("Out \(date, format: .dateTime.month(.abbreviated).day())")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
    }
}

struct StatusBadge: View {
    let status: GameStatus

    var body: some View {
        Label(status.shortTitle, systemImage: status.systemImage)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.15), in: Capsule())
            .foregroundStyle(color)
    }

    private var color: Color {
        switch status {
        case .wantToPlay: .gray
        case .playing: .accentColor
        case .completed: .green
        }
    }
}
