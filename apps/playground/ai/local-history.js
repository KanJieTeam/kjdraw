const DATABASE = 'kjdraw-ai-local'
const VERSION = 1
const STORE = 'conversations'
const RECORD = 'history'

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('本地数据库不可用。'))
  })
}

async function transact(mode, operation) {
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, mode)
      const request = operation(transaction.objectStore(STORE))
      let result
      request.onsuccess = () => { result = request.result }
      transaction.oncomplete = () => resolve(result)
      transaction.onerror = () => reject(transaction.error ?? new Error('本地数据库操作失败。'))
      transaction.onabort = () => reject(transaction.error ?? new Error('本地数据库操作中止。'))
    })
  } finally {
    database.close()
  }
}

export function loadLocalHistory() {
  return transact('readonly', store => store.get(RECORD))
}

export function saveLocalHistory(record) {
  return transact('readwrite', store => store.put(record, RECORD))
}
