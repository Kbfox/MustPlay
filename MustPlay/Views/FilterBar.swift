import SwiftUI

/// Capsule chips: All / Want / Playing / Done, each with a count.
struct FilterBar: View {
    @Binding var selection: GameStatus?
    let counts: [GameStatus?: Int]

    private let options: [GameStatus?] = [nil] + GameStatus.allCases.map { Optional($0) }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(options, id: \.self) { option in
                    chip(for: option)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
        .background(.bar)
    }

    private func chip(for option: GameStatus?) -> some View {
        let isSelected = option == selection
        let count = counts[option] ?? 0

        return Button {
            withAnimation(.snappy) {
                selection = option
            }
        } label: {
            HStack(spacing: 5) {
                Text(option?.shortTitle ?? "All")
                Text("\(count)")
                    .foregroundStyle(isSelected ? .white.opacity(0.75) : .secondary)
            }
            .font(.subheadline.weight(.medium))
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(isSelected ? Color.accentColor : Color(.secondarySystemBackground), in: Capsule())
            .foregroundStyle(isSelected ? .white : .primary)
        }
        .buttonStyle(.plain)
    }
}
