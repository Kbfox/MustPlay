import SwiftUI

/// Rate + one-line note. Saving marks the game completed.
struct CompleteSheet: View {
    let game: BucketGame
    /// Called after save with `true` when this is the first time the game was rated.
    var onSaved: (Bool) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var rating: Int
    @State private var note: String

    init(game: BucketGame, onSaved: @escaping (Bool) -> Void) {
        self.game = game
        self.onSaved = onSaved
        _rating = State(initialValue: game.rating ?? 0)
        _note = State(initialValue: game.note)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 12) {
                        Text(game.name)
                            .font(.headline)
                            .multilineTextAlignment(.center)
                        RatingPicker(rating: $rating, size: 36)
                        Text(ratingCaption)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                }

                Section("One line for future you") {
                    TextField("What will you remember about it?", text: $note, axis: .vertical)
                        .lineLimit(3...6)
                }
            }
            .navigationTitle(game.rating == nil ? "Completed!" : "Edit rating")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save)
                        .disabled(rating == 0)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var ratingCaption: String {
        switch rating {
        case 0: "Tap a star"
        case 1: "Not for me"
        case 2: "It was fine"
        case 3: "Good"
        case 4: "Great"
        default: "All-time favorite"
        }
    }

    private func save() {
        let isFirstCompletion = game.rating == nil
        game.rating = rating
        game.note = note.trimmingCharacters(in: .whitespacesAndNewlines)
        game.status = .completed
        if game.completedAt == nil {
            game.completedAt = .now
        }
        NotificationManager.shared.cancelReleaseReminder(for: game)
        dismiss()
        onSaved(isFirstCompletion)
    }
}
