import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('mfl', {
  __skeleton: true,
});
