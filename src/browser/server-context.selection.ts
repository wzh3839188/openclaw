import { fetchOk, normalizeCdpHttpBaseForJsonEndpoints } from "./cdp.helpers.js";
import { appendCdpPath } from "./cdp.js";
import type { ResolvedBrowserProfile } from "./config.js";
import { BrowserTabNotFoundError, BrowserTargetAmbiguousError } from "./errors.js";
import { getBrowserProfileCapabilities } from "./profile-capabilities.js";
import type { PwAiModule } from "./pw-ai-module.js";
import { getPwAiModule } from "./pw-ai-module.js";
import type { BrowserTab, ProfileRuntimeState } from "./server-context.types.js";
import { resolveTargetIdFromTabs } from "./target-id.js";

type SelectionDeps = {
  profile: ResolvedBrowserProfile;
  getProfileState: () => ProfileRuntimeState;
  ensureBrowserAvailable: () => Promise<void>;
  listTabs: () => Promise<BrowserTab[]>;
  openTab: (url: string) => Promise<BrowserTab>;
};

type SelectionOps = {
  ensureTabAvailable: (targetId?: string) => Promise<BrowserTab>;
  focusTab: (targetId: string) => Promise<void>;
  closeTab: (targetId: string) => Promise<void>;
};

export function createProfileSelectionOps({
  profile,
  getProfileState,
  ensureBrowserAvailable,
  listTabs,
  openTab,
}: SelectionDeps): SelectionOps {
  const cdpHttpBase = normalizeCdpHttpBaseForJsonEndpoints(profile.cdpUrl);
  const capabilities = getBrowserProfileCapabilities(profile);

  const ensureTabAvailable = async (targetId?: string): Promise<BrowserTab> => {
    await ensureBrowserAvailable();
    const profileState = getProfileState();
    let tabs1 = await listTabs();
    if (tabs1.length === 0) {
      if (capabilities.requiresAttachedTab) {
        // Chrome extension relay can briefly drop (MV3 lifecycle, relay restart), or the
        // extension may be re-attaching after navigation (retries up to ~24s for heavy SPAs).
        // If we had a target before, wait for re-announce so one navigation doesn't lose attach.
        if (profileState.lastTargetId?.trim()) {
          const waitMs = 26_000; // Slightly longer than extension re-attach window (~24s).
          const deadlineAt = Date.now() + waitMs;
          while (tabs1.length === 0 && Date.now() < deadlineAt) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            tabs1 = await listTabs();
          }
        }
        if (tabs1.length === 0) {
          throw new BrowserTabNotFoundError(
            `tab not found (no attached Chrome tabs for profile "${profile.name}"). ` +
              "Click the OpenClaw Browser Relay toolbar icon on the tab you want to control (badge ON). " +
              "If you just navigated that tab, the extension may still be re-attaching (up to ~24s); wait and retry, or re-click the icon.",
          );
        }
      } else {
        await openTab("about:blank");
      }
    }

    const tabs = await listTabs();
    const candidates = capabilities.supportsPerTabWs ? tabs.filter((t) => Boolean(t.wsUrl)) : tabs;

    const resolveById = (raw: string) => {
      const resolved = resolveTargetIdFromTabs(raw, candidates);
      if (!resolved.ok) {
        if (resolved.reason === "ambiguous") {
          return "AMBIGUOUS" as const;
        }
        return null;
      }
      return candidates.find((t) => t.targetId === resolved.targetId) ?? null;
    };

    const pickDefault = () => {
      const last = profileState.lastTargetId?.trim() || "";
      const lastResolved = last ? resolveById(last) : null;
      if (lastResolved && lastResolved !== "AMBIGUOUS") {
        return lastResolved;
      }
      // Prefer a real page tab first (avoid service workers/background targets).
      const page = candidates.find((t) => (t.type ?? "page") === "page");
      return page ?? candidates.at(0) ?? null;
    };

    const chosen = targetId ? resolveById(targetId) : pickDefault();

    if (chosen === "AMBIGUOUS") {
      throw new BrowserTargetAmbiguousError();
    }
    if (!chosen) {
      throw new BrowserTabNotFoundError();
    }
    profileState.lastTargetId = chosen.targetId;
    return chosen;
  };

  const resolveTargetIdOrThrow = async (targetId: string): Promise<string> => {
    const tabs = await listTabs();
    const resolved = resolveTargetIdFromTabs(targetId, tabs);
    if (!resolved.ok) {
      if (resolved.reason === "ambiguous") {
        throw new BrowserTargetAmbiguousError();
      }
      throw new BrowserTabNotFoundError();
    }
    return resolved.targetId;
  };

  const focusTab = async (targetId: string): Promise<void> => {
    const resolvedTargetId = await resolveTargetIdOrThrow(targetId);

    if (capabilities.usesPersistentPlaywright) {
      const mod = await getPwAiModule({ mode: "strict" });
      const focusPageByTargetIdViaPlaywright = (mod as Partial<PwAiModule> | null)
        ?.focusPageByTargetIdViaPlaywright;
      if (typeof focusPageByTargetIdViaPlaywright === "function") {
        await focusPageByTargetIdViaPlaywright({
          cdpUrl: profile.cdpUrl,
          targetId: resolvedTargetId,
        });
        const profileState = getProfileState();
        profileState.lastTargetId = resolvedTargetId;
        return;
      }
    }

    await fetchOk(appendCdpPath(cdpHttpBase, `/json/activate/${resolvedTargetId}`));
    const profileState = getProfileState();
    profileState.lastTargetId = resolvedTargetId;
  };

  const closeTab = async (targetId: string): Promise<void> => {
    const resolvedTargetId = await resolveTargetIdOrThrow(targetId);

    // For remote profiles, use Playwright's persistent connection to close tabs
    if (capabilities.usesPersistentPlaywright) {
      const mod = await getPwAiModule({ mode: "strict" });
      const closePageByTargetIdViaPlaywright = (mod as Partial<PwAiModule> | null)
        ?.closePageByTargetIdViaPlaywright;
      if (typeof closePageByTargetIdViaPlaywright === "function") {
        await closePageByTargetIdViaPlaywright({
          cdpUrl: profile.cdpUrl,
          targetId: resolvedTargetId,
        });
        return;
      }
    }

    await fetchOk(appendCdpPath(cdpHttpBase, `/json/close/${resolvedTargetId}`));
  };

  return {
    ensureTabAvailable,
    focusTab,
    closeTab,
  };
}
