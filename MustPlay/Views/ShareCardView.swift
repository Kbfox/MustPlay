import SwiftUI
import UIKit

/// Visual treatments for the completion poster. `dark` is free; the rest are part of Pro.
enum ShareCardStyle: String, CaseIterable, Identifiable {
    case dark, poster, retro, minimal

    var id: String { rawValue }

    var title: String {
        switch self {
        case .dark: "Dark"
        case .poster: "Poster"
        case .retro: "Retro"
        case .minimal: "Minimal"
        }
    }

    var systemImage: String {
        switch self {
        case .dark: "moon.fill"
        case .poster: "photo.fill"
        case .retro: "film"
        case .minimal: "square"
        }
    }

    var requiresPro: Bool { self != .dark }
}

/// 1080×1920 poster (Instagram Story size) rendered off-screen by ImageRenderer.
/// Everything here must be synchronous: the cover is passed in as a UIImage that
/// ShareCardSheet loads beforehand.
struct ShareCardView: View {
    let game: BucketGame
    let cover: UIImage?
    var style: ShareCardStyle = .dark
    /// Completion number when it hit a milestone (1st, 5th, 10th…); drawn as a ribbon on the cover.
    var milestone: Int? = nil

    static let size = CGSize(width: 1080, height: 1920)
    /// ImageRenderer draws outside the app's environment, so `Color.accentColor` would fall back to
    /// system blue. Mirror AccentColor.colorset explicitly.
    static let brand = Color(red: 0.427, green: 0.310, blue: 0.969)

    var body: some View {
        ZStack {
            switch style {
            case .dark: darkLayout
            case .poster: posterLayout
            case .retro: retroLayout
            case .minimal: minimalLayout
            }
        }
        .frame(width: Self.size.width, height: Self.size.height)
    }

    // MARK: - Dark (free)

    private var darkLayout: some View {
        ZStack {
            Color(red: 0.07, green: 0.06, blue: 0.12)
            blurredCover(opacity: 0.55)
            LinearGradient(
                colors: [.black.opacity(0.15), .black.opacity(0.55), .black.opacity(0.9)],
                startPoint: .top,
                endPoint: .bottom
            )

            VStack(spacing: 0) {
                Spacer(minLength: 0)
                coverView(width: 560, cornerRadius: 40)
                    .overlay(
                        RoundedRectangle(cornerRadius: 40, style: .continuous)
                            .stroke(.white.opacity(0.25), lineWidth: 3)
                    )
                    .shadow(color: .black.opacity(0.5), radius: 50, y: 30)
                    .padding(.bottom, 72)

                label("COMPLETED", color: .white.opacity(0.7))
                    .padding(.bottom, 20)
                title(color: .white, design: .rounded)
                    .padding(.bottom, 28)
                StarsView(rating: game.rating ?? 0, size: 64)
                    .padding(.bottom, 40)
                note(color: .white.opacity(0.9))
                    .padding(.bottom, 40)
                date(color: .white.opacity(0.6))

                Spacer(minLength: 0)
                footer(color: .white.opacity(0.85))
                    .padding(.bottom, 90)
            }
        }
    }

    // MARK: - Poster (full-bleed cover)

    private var posterLayout: some View {
        ZStack(alignment: .bottomLeading) {
            Color.black
            if let cover {
                Image(uiImage: cover)
                    .resizable()
                    .scaledToFill()
                    .frame(width: Self.size.width, height: Self.size.height)
                    .clipped()
            } else {
                blurredCover(opacity: 0)
            }
            LinearGradient(
                stops: [
                    .init(color: .clear, location: 0.35),
                    .init(color: .black.opacity(0.75), location: 0.7),
                    .init(color: .black.opacity(0.95), location: 1),
                ],
                startPoint: .top,
                endPoint: .bottom
            )

            VStack(alignment: .leading, spacing: 0) {
                label("COMPLETED", color: Self.brand)
                    .padding(.bottom, 24)
                title(color: .white, design: .default, size: 96, alignment: .leading)
                    .padding(.bottom, 28)
                StarsView(rating: game.rating ?? 0, size: 60)
                    .padding(.bottom, 36)
                note(color: .white.opacity(0.9), alignment: .leading)
                    .padding(.bottom, 36)
                date(color: .white.opacity(0.6))
                    .padding(.bottom, 80)
                footer(color: .white.opacity(0.85))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 90)
            .padding(.bottom, 100)
        }
    }

    // MARK: - Retro (cream paper, stamp)

    private var retroLayout: some View {
        let ink = Color(red: 0.13, green: 0.11, blue: 0.09)
        let paper = Color(red: 0.96, green: 0.92, blue: 0.83)
        let red = Color(red: 0.78, green: 0.16, blue: 0.14)

        return ZStack {
            paper
            // Subtle paper grain.
            LinearGradient(colors: [.black.opacity(0.06), .clear, .black.opacity(0.08)], startPoint: .top, endPoint: .bottom)

            VStack(spacing: 0) {
                Spacer(minLength: 0)

                coverView(width: 560, cornerRadius: 8)
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(ink, lineWidth: 10))
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(ink)
                            .offset(x: 26, y: 26)
                    )
                    .overlay(alignment: .topTrailing) {
                        Text("COMPLETED")
                            .font(.system(size: 40, weight: .black, design: .monospaced))
                            .foregroundStyle(red)
                            .padding(.horizontal, 22)
                            .padding(.vertical, 10)
                            .overlay(Rectangle().stroke(red, lineWidth: 6))
                            .rotationEffect(.degrees(-12))
                            .offset(x: 60, y: -30)
                    }
                    .padding(.bottom, 90)

                title(color: ink, design: .serif)
                    .padding(.bottom, 24)
                Rectangle().fill(ink).frame(width: 120, height: 6)
                    .padding(.bottom, 24)
                StarsView(rating: game.rating ?? 0, size: 60)
                    .padding(.bottom, 36)
                note(color: ink.opacity(0.85))
                    .padding(.bottom, 36)
                date(color: ink.opacity(0.6), design: .monospaced)

                Spacer(minLength: 0)
                footer(color: ink.opacity(0.75))
                    .padding(.bottom, 90)
            }
        }
    }

    // MARK: - Minimal (white)

    private var minimalLayout: some View {
        let ink = Color(red: 0.1, green: 0.1, blue: 0.11)
        return ZStack {
            Color.white

            VStack(spacing: 0) {
                Spacer(minLength: 0)

                coverView(width: 480, cornerRadius: 24)
                    .shadow(color: .black.opacity(0.18), radius: 40, y: 24)
                    .padding(.bottom, 100)

                label("COMPLETED", color: ink.opacity(0.45))
                    .padding(.bottom, 22)
                title(color: ink, design: .default, size: 72)
                    .padding(.bottom, 30)
                StarsView(rating: game.rating ?? 0, size: 52)
                    .padding(.bottom, 44)
                note(color: ink.opacity(0.75))
                    .padding(.bottom, 44)
                date(color: ink.opacity(0.4))

                Spacer(minLength: 0)
                footer(color: ink.opacity(0.5))
                    .padding(.bottom, 90)
            }
        }
    }

    // MARK: - Shared pieces

    private func blurredCover(opacity: Double) -> some View {
        Group {
            if let cover {
                Image(uiImage: cover)
                    .resizable()
                    .scaledToFill()
                    .frame(width: Self.size.width, height: Self.size.height)
                    .blur(radius: 90)
                    .opacity(opacity)
                    .clipped()
            }
        }
    }

    private func coverView(width: CGFloat, cornerRadius: CGFloat) -> some View {
        Group {
            if let cover {
                Image(uiImage: cover)
                    .resizable()
                    .scaledToFill()
            } else {
                ZStack {
                    Color.gray.opacity(0.25)
                    Image(systemName: "gamecontroller.fill")
                        .font(.system(size: 160))
                        .foregroundStyle(.gray)
                }
            }
        }
        .frame(width: width, height: width * 4 / 3)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .overlay(alignment: .topLeading) {
            if let milestone {
                Text(milestoneLabel(milestone))
                    .font(.system(size: 26, weight: .black, design: .rounded))
                    .tracking(2)
                    .foregroundStyle(.black)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 10)
                    .background(Color.yellow, in: Capsule())
                    .shadow(color: .black.opacity(0.3), radius: 10, y: 4)
                    .offset(x: -14, y: -14)
            }
        }
    }

    private func milestoneLabel(_ n: Int) -> String {
        switch n {
        case 1: "FIRST ONE"
        default: "#\(n) DONE"
        }
    }

    private func label(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.system(size: 34, weight: .heavy, design: .rounded))
            .tracking(10)
            .foregroundStyle(color)
    }

    private func title(color: Color, design: Font.Design, size: CGFloat = 76, alignment: TextAlignment = .center) -> some View {
        Text(game.name)
            .font(.system(size: size, weight: .bold, design: design))
            .foregroundStyle(color)
            .multilineTextAlignment(alignment)
            .lineLimit(3)
            .minimumScaleFactor(0.6)
            .padding(.horizontal, alignment == .center ? 100 : 0)
    }

    @ViewBuilder
    private func note(color: Color, alignment: TextAlignment = .center) -> some View {
        if !game.note.isEmpty {
            Text("“\(game.note)”")
                .font(.system(size: 44, weight: .medium, design: .serif).italic())
                .foregroundStyle(color)
                .multilineTextAlignment(alignment)
                .lineLimit(4)
                .minimumScaleFactor(0.7)
                .padding(.horizontal, alignment == .center ? 120 : 0)
        }
    }

    @ViewBuilder
    private func date(color: Color, design: Font.Design = .rounded) -> some View {
        if let date = game.completedAt {
            Text(date, format: .dateTime.month(.wide).year())
                .font(.system(size: 34, weight: .medium, design: design))
                .foregroundStyle(color)
        }
    }

    private func footer(color: Color) -> some View {
        HStack(spacing: 14) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 38))
            Text("MustPlay")
                .font(.system(size: 40, weight: .bold, design: .rounded))
            Text("·")
                .font(.system(size: 40))
            Text("my gaming bucket list")
                .font(.system(size: 34, weight: .medium, design: .rounded))
        }
        .foregroundStyle(color)
    }
}
