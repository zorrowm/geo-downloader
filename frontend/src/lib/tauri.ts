import { invoke } from '@tauri-apps/api/core'

export type InvokeArgs = Record<string, unknown>

export function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function assertTauriRuntime(feature = '该功能') {
  if (!isTauriRuntime()) {
    throw new Error(`${feature}仅支持桌面版`)
  }
}

export async function invokeCommand<T, TArgs extends InvokeArgs = InvokeArgs>(
  command: string,
  args?: TArgs,
): Promise<T> {
  return invoke<T>(command, args)
}
