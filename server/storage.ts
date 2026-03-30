// server/storage.ts -- thin re-export shim
// All implementation has moved to server/storage/*.storage.ts modules
// The facade in server/storage/index.ts assembles them into a single DatabaseStorage class
// This file exists so that `import { storage } from "./storage"` continues to work unchanged

export { storage, type IStorage } from "./storage/index";
