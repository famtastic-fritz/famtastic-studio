function copy(value) {
  return value === undefined ? undefined : structuredClone(value);
}

class FakeDocumentSnapshot {
  constructor(ref, value) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = value !== undefined;
    this.value = copy(value);
  }

  data() {
    return copy(this.value);
  }
}

class FakeDocumentReference {
  constructor(firestore, collectionName, id) {
    this.firestore = firestore;
    this.collectionName = collectionName;
    this.id = id;
    this.path = `${collectionName}/${id}`;
  }

  async get() {
    return new FakeDocumentSnapshot(this, this.firestore.records.get(this.path));
  }
}

class FakeCollectionReference {
  constructor(firestore, name) {
    this.firestore = firestore;
    this.id = name;
    this.path = name;
  }

  doc(id) {
    return new FakeDocumentReference(this.firestore, this.id, id);
  }

  async get() {
    const prefix = `${this.id}/`;
    const docs = [...this.firestore.records.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, value]) => new FakeDocumentSnapshot(this.doc(path.slice(prefix.length)), value));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}

class FakeTransaction {
  constructor(firestore) {
    this.firestore = firestore;
    this.operations = [];
    this.hasWritten = false;
  }

  async get(ref) {
    if (this.hasWritten) throw Object.assign(new Error('Firestore transactions require all reads before writes'), { code: 'fake_read_after_write' });
    return new FakeDocumentSnapshot(ref, this.firestore.records.get(ref.path));
  }

  create(ref, value) {
    this.hasWritten = true;
    this.operations.push({ type: 'create', ref, value: copy(value) });
    return this;
  }

  set(ref, value, options = undefined) {
    this.hasWritten = true;
    this.operations.push({ type: 'set', ref, value: copy(value), options });
    return this;
  }

  update(ref, value) {
    this.hasWritten = true;
    this.operations.push({ type: 'update', ref, value: copy(value) });
    return this;
  }

  commit() {
    const working = new Map([...this.firestore.records.entries()].map(([key, value]) => [key, copy(value)]));
    for (const operation of this.operations) {
      const existing = working.get(operation.ref.path);
      if (operation.type === 'create' && existing !== undefined) {
        throw Object.assign(new Error(`Document already exists: ${operation.ref.path}`), { code: 6 });
      }
      if (operation.type === 'update' && existing === undefined) {
        throw Object.assign(new Error(`Document does not exist: ${operation.ref.path}`), { code: 5 });
      }
      if (operation.type === 'update' || operation.options?.merge) {
        working.set(operation.ref.path, { ...(existing || {}), ...copy(operation.value) });
      } else {
        working.set(operation.ref.path, copy(operation.value));
      }
    }
    this.firestore.records = working;
  }
}

export class FakeFirestore {
  constructor() {
    this.records = new Map();
  }

  collection(name) {
    return new FakeCollectionReference(this, name);
  }

  async runTransaction(operation) {
    const transaction = new FakeTransaction(this);
    const result = await operation(transaction);
    transaction.commit();
    return result;
  }

  seed(path, value) {
    this.records.set(path, copy(value));
  }

  delete(path) {
    this.records.delete(path);
  }

  read(path) {
    return copy(this.records.get(path));
  }

  dump() {
    return Object.fromEntries([...this.records.entries()].map(([key, value]) => [key, copy(value)]));
  }
}
