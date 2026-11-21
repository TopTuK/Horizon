import { ref } from 'vue'

const MIME = 'application/x-horizon'

/** Payload of the drag in progress; dataTransfer contents are unreadable during dragover. */
export const dragPayload = ref(null)

export function startDrag(event, payload, effect = 'copyMove') {
  dragPayload.value = payload
  event.dataTransfer.effectAllowed = effect
  event.dataTransfer.setData(MIME, JSON.stringify(payload))
  event.dataTransfer.setData('text/plain', payload.type)
}

export function endDrag() {
  dragPayload.value = null
}

export function readDrop(event) {
  const raw = event.dataTransfer.getData(MIME)
  dragPayload.value = null
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function isDragging(...types) {
  return !!dragPayload.value && (!types.length || types.includes(dragPayload.value.type))
}
