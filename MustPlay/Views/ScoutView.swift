import SwiftUI
import SwiftData

/// One entry in the Scout transcript.
enum ScoutItem: Identifiable {
    case user(String)
    case status(String)
    case assistant(String)
    case games(title: String?, items: [ScoutGameCard])
    case taste(summary: String, tags: [ScoutTasteTag])
    case crossover([ScoutCrossCard])
    case error(String)

    var id: String {
        switch self {
        case .user(let t): "u-\(t.hashValue)"
        case .status(let t): "s-\(t.hashValue)"
        case .assistant(let t): "a-\(t.hashValue)"
        case .games(let title, let items): "g-\(title ?? "")-\(items.map(\.id).joined())"
        case .taste(let summary, _): "t-\(summary.hashValue)"
        case .crossover(let items): "c-\(items.map(\.id).joined())"
        case .error(let t): "e-\(t.hashValue)"
        }
    }

    var isError: Bool {
        if case .error = self { return true }
        return false
    }
}

/// The four things Scout is good at. Free text works too.
enum ScoutPrompt: String, CaseIterable, Identifiable {
    case pick, discover, taste, postcredits

    var id: String { rawValue }

    var title: String {
        switch self {
        case .pick: "Pick from my pile"
        case .discover: "Find me something new"
        case .taste: "What's my taste?"
        case .postcredits: "Pair with a film"
        }
    }

    var subtitle: String {
        switch self {
        case .pick: "Rank my Want list against what I loved"
        case .discover: "Games I'd never search for"
        case .taste: "My profile, from what I've finished"
        case .postcredits: "A film or album after my last finish"
        }
    }

    var systemImage: String {
        switch self {
        case .pick: "list.star"
        case .discover: "binoculars.fill"
        case .taste: "person.crop.circle.badge.checkmark"
        case .postcredits: "film.stack"
        }
    }

    var intent: ScoutIntent {
        switch self {
        case .pick: .pick
        case .discover: .discover
        case .taste: .taste
        case .postcredits: .postcredits
        }
    }

    var message: String {
        switch self {
        case .pick: "What should I play next from my list?"
        case .discover: "Find me something new I'd love."
        case .taste: "What's my taste in games?"
        case .postcredits: "What should I watch or listen to after the game I just finished?"
        }
    }
}

@Observable
final class ScoutSession {
    var transcript: [ScoutItem] = []
    var isRunning = false
    /// Last few user/assistant turns, sent back so free-text follow-ups keep context.
    private var history: [ScoutRequest.Message] = []
    private var task: Task<Void, Never>?
    private var lastAsk: (text: String, intent: ScoutIntent?, library: [BucketGame], focus: BucketGame?, onResolved: ([Int: String]) -> Void)?

    /// Scout can retry the previous question after a failure.
    var canRetry: Bool { lastAsk != nil && transcript.last?.isError == true }

    /// A local note from the app itself (guidance that needs no network round-trip).
    func note(_ text: String, replyingTo userText: String) {
        transcript.append(.user(userText))
        transcript.append(.assistant(text))
    }

    func retry() {
        guard let last = lastAsk, !isRunning else { return }
        // Drop the failed turn so the transcript doesn't repeat the question.
        if transcript.last?.isError == true { transcript.removeLast() }
        if case .user = transcript.last { transcript.removeLast() }
        if history.last?.role == "user" { history.removeLast() }
        ask(last.text, intent: last.intent, library: last.library, focus: last.focus, onResolved: last.onResolved)
    }

    func ask(_ text: String, intent: ScoutIntent?, library: [BucketGame], focus: BucketGame?, onResolved: @escaping ([Int: String]) -> Void) {
        guard !isRunning else { return }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        lastAsk = (trimmed, intent, library, focus, onResolved)
        transcript.append(.user(trimmed))
        history.append(.init(role: "user", content: trimmed))
        isRunning = true

        let request = ScoutRequest(
            intent: intent,
            messages: Array(history.suffix(6)),
            library: ScoutClient.library(from: library),
            focus_igdb_id: focus?.igdbID
        )

        task = Task { @MainActor in
            defer { isRunning = false }
            var replies: [String] = []
            do {
                for try await event in ScoutClient.stream(request) {
                    switch event {
                    case .status(let text):
                        replaceTrailingStatus(with: text)
                    case .games(let title, let items):
                        dropTrailingStatus()
                        if !items.isEmpty { transcript.append(.games(title: title, items: items)) }
                    case .taste(let summary, let tags):
                        dropTrailingStatus()
                        transcript.append(.taste(summary: summary, tags: tags))
                    case .crossover(let items):
                        dropTrailingStatus()
                        transcript.append(.crossover(items))
                    case .resolved(let map):
                        onResolved(map)
                    case .message(let text):
                        dropTrailingStatus()
                        transcript.append(.assistant(text))
                        replies.append(text)
                    case .error(let text):
                        dropTrailingStatus()
                        transcript.append(.error(Self.friendly(serverError: text)))
                    case .done:
                        dropTrailingStatus()
                    }
                }
            } catch is CancellationError {
                dropTrailingStatus()
            } catch {
                dropTrailingStatus()
                transcript.append(.error(Self.friendly(error)))
            }
            if !replies.isEmpty {
                history.append(.init(role: "assistant", content: replies.joined(separator: " ")))
            }
        }
    }

    private static func friendly(_ error: Error) -> String {
        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed:
                return "You're offline. Scout needs a connection to reach Qloo."
            case .timedOut:
                return "That took too long. Qloo or the model didn't answer in time."
            case .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed:
                return "Can't reach Scout's server right now."
            default:
                break
            }
        }
        if let scoutError = error as? ScoutClient.ScoutError {
            return scoutError.localizedDescription
        }
        return "Something went wrong talking to Scout."
    }

    private static func friendly(serverError text: String) -> String {
        let code = text.split(separator: ":", maxSplits: 1).first.map(String.init) ?? ""
        switch code {
        case "llm_quota": return "Scout's daily AI budget is used up. It resets at midnight UTC."
        case "llm": return "The model behind Scout is busy. Try again in a moment."
        case "qloo": return "Qloo's taste API didn't answer. It happens; try again in a moment."
        default: return "Scout hit a snag on the server. Try again in a moment."
        }
    }

    func cancel() {
        task?.cancel()
    }

    private func replaceTrailingStatus(with text: String) {
        if case .status = transcript.last {
            transcript[transcript.count - 1] = .status(text)
        } else {
            transcript.append(.status(text))
        }
    }

    private func dropTrailingStatus() {
        if case .status = transcript.last {
            transcript.removeLast()
        }
    }
}

struct ScoutView: View {
    /// Called after "Start playing"; the caller navigates to the game.
    var onStart: (BucketGame) -> Void
    /// Fires this prompt as soon as the sheet appears (post-credits after a completion).
    var autoPrompt: ScoutPrompt? = nil

    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    @Environment(PurchaseManager.self) private var purchases
    @Query(sort: \BucketGame.sortOrder) private var games: [BucketGame]

    @State private var session = ScoutSession()
    @State private var draft = ""
    @State private var showPaywall = false
    @State private var addedIDs: Set<Int> = []
    @State private var addCount = 0
    @FocusState private var inputFocused: Bool

    private var lovedCount: Int {
        games.filter { ($0.status == .completed && ($0.rating ?? 0) >= 4) || $0.status == .playing }.count
    }

    private var wantCount: Int {
        games.filter { $0.status == .wantToPlay && !$0.isUpcoming }.count
    }

    private var lastCompleted: BucketGame? {
        games.filter { $0.status == .completed }.max { ($0.completedAt ?? .distantPast) < ($1.completedAt ?? .distantPast) }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 14) {
                            if session.transcript.isEmpty {
                                intro
                            }
                            ForEach(session.transcript) { item in
                                row(for: item)
                                    .id(item.id)
                            }
                            Color.clear.frame(height: 1).id("bottom")
                        }
                        .padding(.horizontal)
                        .padding(.top, 8)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .onChange(of: session.transcript.count) {
                        withAnimation(.easeOut(duration: 0.25)) {
                            proxy.scrollTo("bottom", anchor: .bottom)
                        }
                    }
                }
                inputBar
            }
            .navigationTitle("Scout")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
        .sheet(isPresented: $showPaywall) {
            PaywallSheet()
        }
        .sensoryFeedback(.success, trigger: addCount)
        .onDisappear { session.cancel() }
        .task {
            if let autoPrompt, session.transcript.isEmpty {
                send(autoPrompt.message, intent: autoPrompt.intent)
            }
        }
    }

    // MARK: - Intro

    private var intro: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Scout knows what you love.")
                    .font(.title2.bold())
                Text(lovedCount >= 2
                     ? "Grounded in \(lovedCount) games you finished or are playing, cross-checked against Qloo's taste graph of 250M+ titles, films and albums."
                     : "Rate a couple of finished games first. Scout reads your taste from what you loved, then asks Qloo's taste graph what fits.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                ForEach(ScoutPrompt.allCases) { prompt in
                    Button {
                        send(prompt.message, intent: prompt.intent)
                    } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            Image(systemName: prompt.systemImage)
                                .font(.title3)
                                .foregroundStyle(Color.accentColor)
                            Text(prompt.title)
                                .font(.subheadline.weight(.semibold))
                            Text(prompt.subtitle)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(!isAvailable(prompt))
                    .opacity(isAvailable(prompt) ? 1 : 0.5)
                }
            }
            if lovedCount == 0 {
                Label("Scout learns your taste from games you rated 4 stars or more, or are playing now.", systemImage: "star")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else if wantCount == 0 {
                Label("Add games to your Want list and Scout can rank them for you.", systemImage: "bookmark")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.bottom, 8)
    }

    /// Canned prompts only make sense with something to work from; free text is always allowed.
    private func isAvailable(_ prompt: ScoutPrompt) -> Bool {
        switch prompt {
        case .pick: lovedCount > 0 && wantCount > 0
        case .discover, .taste: lovedCount > 0
        case .postcredits: lastCompleted != nil
        }
    }

    /// Client-side version of the Worker's guards, so the answer is instant and works offline.
    private func guidance(for intent: ScoutIntent?) -> String? {
        switch intent {
        case .pick where wantCount == 0:
            "Your Want pile is empty. Add a few games you mean to play and I'll rank them against what you loved."
        case .pick, .taste, .discover:
            lovedCount == 0 ? "I don't know your taste yet. Mark a game as Playing, or rate a finished one 4 stars or more, then ask again." : nil
        case .postcredits where lastCompleted == nil:
            "Finish a game first and I'll pair it with a film or an album."
        default:
            nil
        }
    }

    // MARK: - Rows

    @ViewBuilder
    private func row(for item: ScoutItem) -> some View {
        switch item {
        case .user(let text):
            Text(text)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .trailing)
        case .status(let text):
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text(text)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding(.leading, 4)
            .transition(.opacity)
        case .assistant(let text):
            Text(text)
                .font(.body)
                .padding(.horizontal, 2)
        case .games(let title, let items):
            VStack(alignment: .leading, spacing: 10) {
                if let title, !title.isEmpty {
                    Text(title)
                        .font(.headline)
                }
                ForEach(items) { card in
                    gameCard(card)
                }
            }
        case .taste(let summary, let tags):
            TasteCard(summary: summary, tags: tags)
        case .crossover(let items):
            VStack(alignment: .leading, spacing: 10) {
                ForEach(items) { card in
                    crossCard(card)
                }
            }
        case .error(let text):
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Label(text, systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if session.canRetry {
                    Button("Retry") { session.retry() }
                        .font(.footnote.weight(.semibold))
                        .buttonStyle(.bordered)
                        .controlSize(.mini)
                }
            }
        }
    }

    private func gameCard(_ card: ScoutGameCard) -> some View {
        let existing = card.igdb_id.flatMap { id in games.first { $0.igdbID == id } }
        return HStack(alignment: .top, spacing: 12) {
            CoverImage(url: existing?.coverURL ?? card.coverURL, cornerRadius: 10)
                .frame(width: 64, height: 86)
            VStack(alignment: .leading, spacing: 6) {
                Text(card.name)
                    .font(.headline)
                    .lineLimit(2)
                Text(card.reason)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if !card.tags.isEmpty {
                    Text(card.tags.prefix(3).joined(separator: " · "))
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(Color.accentColor)
                        .lineLimit(1)
                }
                cardAction(card, existing: existing)
                    .padding(.top, 2)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    @ViewBuilder
    private func cardAction(_ card: ScoutGameCard, existing: BucketGame?) -> some View {
        if let existing {
            if existing.status == .wantToPlay {
                Button {
                    existing.status = .playing
                    dismiss()
                    onStart(existing)
                } label: {
                    Label("Start playing", systemImage: "play.fill")
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
            } else {
                Label(existing.status == .playing ? "Playing now" : "Completed", systemImage: existing.status.systemImage)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        } else if let id = card.igdb_id, addedIDs.contains(id) {
            Label("Added", systemImage: "checkmark")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
        } else {
            Button {
                Task { await add(card) }
            } label: {
                Label("Add to list", systemImage: "plus")
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
    }

    private func crossCard(_ card: ScoutCrossCard) -> some View {
        HStack(alignment: .top, spacing: 12) {
            if let url = card.imageURL {
                CoverImage(url: url, cornerRadius: 10)
                    .frame(width: 64, height: card.type == "artist" ? 64 : 86)
            } else {
                Image(systemName: card.systemImage)
                    .font(.title3)
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(Color.accentColor.gradient, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(card.typeLabel.uppercased())
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(Color.accentColor)
                    if let year = card.year {
                        Text(String(year))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                Text(card.name)
                    .font(.headline)
                Text(card.reason)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if !card.tags.isEmpty {
                    Text(card.tags.prefix(3).joined(separator: " · "))
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(Color.accentColor)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    // MARK: - Input

    private var inputBar: some View {
        VStack(spacing: 8) {
            if !session.transcript.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(ScoutPrompt.allCases) { prompt in
                            Button {
                                send(prompt.message, intent: prompt.intent)
                            } label: {
                                Label(prompt.title, systemImage: prompt.systemImage)
                                    .font(.caption.weight(.medium))
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 6)
                                    .background(Color(.secondarySystemBackground), in: Capsule())
                            }
                            .buttonStyle(.plain)
                            .disabled(session.isRunning || !isAvailable(prompt))
                        }
                    }
                    .padding(.horizontal)
                }
            }
            HStack(spacing: 10) {
                TextField("Ask Scout… e.g. short and cozy, on Switch", text: $draft, axis: .vertical)
                    .lineLimit(1...4)
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .focused($inputFocused)
                    .onSubmit { send(draft, intent: .chat) }
                    .submitLabel(.send)
                Button {
                    send(draft, intent: .chat)
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 30))
                }
                .disabled(session.isRunning || draft.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(.horizontal)
        }
        .padding(.vertical, 10)
        .background(.bar)
    }

    private func send(_ text: String, intent: ScoutIntent?) {
        draft = ""
        inputFocused = false
        if let guidance = guidance(for: intent) {
            session.note(guidance, replyingTo: text)
            return
        }
        // Ids cached from the pre-key fixture graph are not Qloo ids; let the Worker resolve again.
        for game in games where game.qlooEntityID?.hasPrefix("fx:") == true {
            game.qlooEntityID = nil
        }
        session.ask(text, intent: intent, library: games, focus: lastCompleted) { map in
            for game in games {
                if let id = map[game.igdbID], game.qlooEntityID != id {
                    game.qlooEntityID = id
                }
            }
        }
    }

    @MainActor
    private func add(_ card: ScoutGameCard) async {
        guard purchases.canAddGame(currentCount: games.count) else {
            showPaywall = true
            return
        }
        let hits: [IGDBGame]
        do {
            hits = try await IGDBClient.shared.search(card.name, limit: 5)
        } catch {
            session.transcript.append(.error("Couldn't reach the game database to add \(card.name). Try again in a moment."))
            return
        }
        guard let hit = hits.first(where: { $0.id == card.igdb_id }) ?? hits.first else {
            session.transcript.append(.error("Couldn't find \(card.name) in the game database."))
            return
        }
        guard !games.contains(where: { $0.igdbID == hit.id }) else {
            addedIDs.insert(hit.id)
            return
        }
        let nextOrder = (games.map(\.sortOrder).max() ?? -1) + 1
        let bucket = BucketGame(from: hit, sortOrder: nextOrder)
        bucket.qlooEntityID = card.qloo_id
        context.insert(bucket)
        NotificationManager.shared.scheduleReleaseReminder(for: bucket)
        addedIDs.insert(hit.id)
        if let id = card.igdb_id { addedIDs.insert(id) }
        addCount += 1
    }
}

/// Taste profile: one line of prose plus the strongest tags, sized by affinity.
struct TasteCard: View {
    let summary: String
    let tags: [ScoutTasteTag]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Your taste", systemImage: "person.crop.circle.badge.checkmark")
                .font(.caption.weight(.bold))
                .foregroundStyle(.white.opacity(0.85))
            Text(summary)
                .font(.title3.weight(.semibold))
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
            FlowTags(tags: tags)
            Text("Taste analysis by Qloo")
                .font(.caption2)
                .foregroundStyle(.white.opacity(0.7))
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(colors: [Color.accentColor, Color.accentColor.opacity(0.7)], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 18, style: .continuous)
        )
    }
}

private struct FlowTags: View {
    let tags: [ScoutTasteTag]

    var body: some View {
        // Two rows is plenty for six tags; a Layout would be overkill here.
        let rows = stride(from: 0, to: tags.count, by: 3).map { Array(tags[$0..<min($0 + 3, tags.count)]) }
        VStack(alignment: .leading, spacing: 8) {
            ForEach(rows.indices, id: \.self) { index in
                HStack(spacing: 8) {
                    ForEach(rows[index], id: \.name) { tag in
                        Text(tag.name)
                            .font(.system(size: 12 + CGFloat(tag.affinity) * 4, weight: .semibold))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(.white.opacity(0.18 + tag.affinity * 0.2), in: Capsule())
                            .foregroundStyle(.white)
                    }
                }
            }
        }
    }
}
