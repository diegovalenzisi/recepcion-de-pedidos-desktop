import { query, orderByChild, equalTo, startAt, endAt, limitToLast } from 'firebase/database';

export const buildDateRangeQuery = (ref, dateField, startDateStr, endDateStr) => {
  if (startDateStr && endDateStr) {
    if (startDateStr === endDateStr) {
      return query(ref, orderByChild(dateField), equalTo(startDateStr));
    }
    return query(ref, orderByChild(dateField), startAt(startDateStr), endAt(endDateStr));
  }
  return ref;
};

export const buildStatusQuery = (ref, statusField, statusValue) => {
  return query(ref, orderByChild(statusField), equalTo(statusValue));
};

export const buildRecentQuery = (ref, orderByField, limit = 50) => {
  return query(ref, orderByChild(orderByField), limitToLast(limit));
};

export const paginateQuery = (ref, orderByField, lastValue, limit = 20) => {
  if (lastValue) {
     return query(ref, orderByChild(orderByField), endAt(lastValue), limitToLast(limit));
  }
  return query(ref, orderByChild(orderByField), limitToLast(limit));
};