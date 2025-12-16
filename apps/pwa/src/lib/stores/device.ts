import { derived, writable } from 'svelte/store'
import type { DeviceCredentials } from '$lib/api/client'
import { getDeviceCredentials } from '$lib/api/client'

const deviceStore = writable<DeviceCredentials | null>(getDeviceCredentials())

export const pairedDevice = derived(deviceStore, ($device) =>
  $device ? { deviceId: $device.deviceId, deviceName: $device.deviceName } : null
)

export const isPaired = derived(deviceStore, ($device) => Boolean($device?.deviceId))

export function setDeviceStore(value: DeviceCredentials | null) {
  deviceStore.set(value)
}

export function clearDeviceStore() {
  deviceStore.set(null)
}
