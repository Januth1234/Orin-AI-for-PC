import { openDB } from 'idb'

const dbPromise = openDB('orin-desktop', 1, { upgrade(db) { db.createObjectStore('state') } })

export async function loadState() { return (await dbPromise).get('state', 'workspace') }
export async function saveState(state) { return (await dbPromise).put('state', state, 'workspace') }
