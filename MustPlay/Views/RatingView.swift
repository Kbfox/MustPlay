import SwiftUI

/// Read-only stars.
struct StarsView: View {
    let rating: Int
    var size: CGFloat = 16

    var body: some View {
        HStack(spacing: size * 0.15) {
            ForEach(1...5, id: \.self) { index in
                Image(systemName: index <= rating ? "star.fill" : "star")
                    .font(.system(size: size))
                    .foregroundStyle(index <= rating ? Color.yellow : Color.secondary.opacity(0.4))
            }
        }
        .accessibilityLabel("\(rating) out of 5 stars")
    }
}

/// Tappable stars.
struct RatingPicker: View {
    @Binding var rating: Int
    var size: CGFloat = 32

    var body: some View {
        HStack(spacing: size * 0.25) {
            ForEach(1...5, id: \.self) { index in
                Button {
                    withAnimation(.bouncy) {
                        rating = index
                    }
                } label: {
                    Image(systemName: index <= rating ? "star.fill" : "star")
                        .font(.system(size: size))
                        .foregroundStyle(index <= rating ? Color.yellow : Color.secondary.opacity(0.4))
                        .scaleEffect(index == rating ? 1.15 : 1)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(index) star\(index == 1 ? "" : "s")")
            }
        }
        .sensoryFeedback(.selection, trigger: rating)
    }
}
