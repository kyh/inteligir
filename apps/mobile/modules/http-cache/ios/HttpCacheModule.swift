import ExpoModulesCore

public class HttpCacheModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HttpCache")

    // the session under every fetch, Expo's and React Native's, stores in the shared cache
    AsyncFunction("clear") {
      URLCache.shared.removeAllCachedResponses()
    }
  }
}
