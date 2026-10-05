import type { CapMartServices } from './contracts';
export type HostBindings = CapMartServices;
/** Pass the host's existing authenticated services, preserving method context. */
export function createHostAdapter(host: HostBindings): CapMartServices {
  return {
    identity: host.identity,
    loadProgress: () => host.loadProgress(),
    saveProgress: p => host.saveProgress(p),
    getBalance: () => host.getBalance(),
    purchaseHelp: input => host.purchaseHelp(input),
    submitResult: result => host.submitResult(result),
    getRanking: input => host.getRanking(input),
    onOpen: () => host.onOpen?.(),
    onClose: () => host.onClose?.(),
  };
}
