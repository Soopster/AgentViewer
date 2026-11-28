/** Embedded so Next's server bundle and the published CLI carry the native helper. */
export const APPLE_VOICE_SOURCE = String.raw`
import Foundation
import AVFoundation
import Speech

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

@available(macOS 26.0, *)
func transcribe() async throws {
    guard SpeechTranscriber.isAvailable else {
        fail("Apple on-device transcription is unavailable on this Mac. Configure local Whisper as a fallback.")
    }
    let language = CommandLine.arguments[2]
    let requested = language == "auto" ? Locale.current : Locale(identifier: language)
    guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: requested) else {
        fail("Apple on-device transcription does not support the requested language. Set AGENT_VIEWER_VOICE_LANGUAGE to a supported locale or configure local Whisper.")
    }
    let module = SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [], attributeOptions: [])
    let installed = await SpeechTranscriber.installedLocales
    if !installed.contains(locale) {
        guard ProcessInfo.processInfo.environment["AGENT_VIEWER_APPLE_DOWNLOAD_MODELS"] == "1" else {
            fail("Apple speech model is not installed for \(locale.identifier). Set AGENT_VIEWER_APPLE_DOWNLOAD_MODELS=1 to allow Apple's model download, or configure local Whisper.")
        }
        if let installation = try await AssetInventory.assetInstallationRequest(supporting: [module]) {
            try await installation.downloadAndInstall()
        }
    }
    let file = try AVAudioFile(forReading: URL(fileURLWithPath: CommandLine.arguments[1]))
    guard file.length > 0 else { fail("Recording contains no audio frames.") }
    let analyzer = SpeechAnalyzer(modules: [module])
    let results = Task { () throws -> String in
        var text = ""
        for try await result in module.results {
            text += String(result.text.characters)
        }
        return text
    }
    do {
        if let end = try await analyzer.analyzeSequence(from: file) {
            try await analyzer.finalizeAndFinish(through: end)
        } else {
            await analyzer.cancelAndFinishNow()
        }
        let text = try await results.value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { fail("No speech detected. Try recording again.") }
        print(text)
    } catch {
        results.cancel()
        await analyzer.cancelAndFinishNow()
        throw error
    }
}

Task {
    guard CommandLine.arguments.count == 3 else { fail("Audio path and locale required.") }
    if #available(macOS 26.0, *) {
        do { try await transcribe(); exit(0) }
        catch { fail("Apple on-device transcription failed: \(error.localizedDescription)") }
    } else {
        fail("Apple SpeechAnalyzer requires macOS 26 or later. Configure local Whisper for this Mac.")
    }
}
dispatchMain()
`

export type VoiceEngine = 'apple' | 'whisper' | 'auto'
export function voiceEngine(platform: string = process.platform, setting = process.env.AGENT_VIEWER_VOICE_ENGINE): VoiceEngine {
  if (setting && !['auto', 'apple', 'whisper'].includes(setting)) throw new Error('AGENT_VIEWER_VOICE_ENGINE must be auto, apple, or whisper.')
  if (setting === 'apple' && platform !== 'darwin') throw new Error('Apple transcription requires macOS.')
  return setting === 'whisper' ? 'whisper' : platform === 'darwin' ? setting === 'apple' ? 'apple' : 'auto' : 'whisper'
}
