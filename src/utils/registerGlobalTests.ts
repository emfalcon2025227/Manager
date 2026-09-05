import * as testModule from './phase53DailyRevenueCollectionTests';

export function registerGlobalTests() {
  if (typeof window !== 'undefined') {
    Object.assign(window, testModule);
  }
}
