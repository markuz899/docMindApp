import os from 'node:os'
import type { HardwareInfo, ModelFit, RegistryModel } from '@shared/types'

const GB = 1024 ** 3

/**
 * Only what the OS actually reports. No synthetic score, no benchmark: a number
 * we did not measure would be worse than no number at all.
 */
export function detectHardware(): HardwareInfo {
  const platform = os.platform()
  const arch = os.arch()
  const totalMemoryBytes = os.totalmem()
  return {
    platform,
    arch,
    appleSilicon: platform === 'darwin' && arch === 'arm64',
    totalMemoryBytes,
    totalMemoryGb: Math.round((totalMemoryBytes / GB) * 10) / 10,
    cpuCount: os.cpus().length
  }
}

/** Compares the manifest's own RAM hints against the detected memory. */
export function modelFit(model: RegistryModel, hardware: HardwareInfo): ModelFit {
  const ram = hardware.totalMemoryGb
  if (ram >= model.recommendedRamGb) return 'recommended'
  if (ram >= model.minimumRamGb) return 'compatible'
  return 'too_large'
}
