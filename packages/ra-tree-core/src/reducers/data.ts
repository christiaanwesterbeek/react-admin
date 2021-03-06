import { Reducer } from 'redux';
import {
    CREATE,
    DELETE,
    DELETE_MANY,
    FETCH_END,
    getFetchedAt,
    GET_LIST,
    GET_MANY,
    GET_MANY_REFERENCE,
    GET_ONE,
    Identifier,
    Record,
    UPDATE,
    UPDATE_MANY,
} from 'ra-core';
import {
    GET_TREE_ROOT_NODES,
    GET_TREE_CHILDREN_NODES,
    MOVE_NODE,
} from '../actions';

/**
 * A list of records indexed by id, together with their fetch dates
 *
 * Note that the fetchedAt property isn't enumerable.
 *
 * @example
 * {
 *      12: { id: 12, title: "hello" },
 *      34: { id: 34, title: "world" },
 *      fetchedAt: {
 *          12: new Date('2019-02-06T21:23:07.049Z'),
 *          34: new Date('2019-02-06T21:23:07.049Z'),
 *      }
 * }
 */
interface RecordSetWithDate {
    // FIXME: use [key: Identifier] once typeScript accepts any type as index (see https://github.com/Microsoft/TypeScript/pull/26797)
    [key: string]: Record | object;
    [key: number]: Record;
    fetchedAt: {
        // FIXME: use [key: Identifier] once typeScript accepts any type as index (see https://github.com/Microsoft/TypeScript/pull/26797)
        [key: string]: Date;
        [key: number]: Date;
    };
}

/**
 * Make the fetchedAt property non enumerable
 */
export const hideFetchedAt = (
    records: RecordSetWithDate
): RecordSetWithDate => {
    Object.defineProperty(records, 'fetchedAt', {
        enumerable: false,
        configurable: false,
        writable: false,
    });
    return records;
};

/**
 * Add new records to the pool, and remove outdated ones.
 *
 * This is the equivalent of a stale-while-revalidate caching strategy:
 * The cached data is displayed before fetching, and stale data is removed
 * only once fresh data is fetched.
 */
export const addRecords = (
    newRecords: Record[] = [],
    oldRecords: RecordSetWithDate
): RecordSetWithDate => {
    const newRecordsById = {};
    newRecords.forEach(record => (newRecordsById[record.id] = record));

    const newFetchedAt = getFetchedAt(
        newRecords.map(({ id }) => id),
        oldRecords.fetchedAt
    );

    const records = { fetchedAt: newFetchedAt };
    Object.keys(newFetchedAt).forEach(
        id => (records[id] = newRecordsById[id] || oldRecords[id])
    );

    return hideFetchedAt(records);
};

/**
 * Remove records from the pool
 */
const removeRecords = (
    removedRecordIds: Identifier[] = [],
    oldRecords: RecordSetWithDate
): RecordSetWithDate => {
    const records = Object.entries(oldRecords)
        .filter(([key]) => !removedRecordIds.includes(key))
        .reduce((obj, [key, val]) => ({ ...obj, [key]: val }), {
            fetchedAt: {}, // TypeScript warns later if this is not defined
        });
    records.fetchedAt = Object.entries(oldRecords.fetchedAt)
        .filter(([key]) => !removedRecordIds.includes(key))
        .reduce((obj, [key, val]) => ({ ...obj, [key]: val }), {});

    return hideFetchedAt(records);
};

const initialState = hideFetchedAt({ fetchedAt: {} });

const dataReducer: Reducer<RecordSetWithDate> = (
    previousState = initialState,
    { payload, meta }
) => {
    if (meta && meta.optimistic) {
        if (meta.fetch === UPDATE || meta.fetch === MOVE_NODE) {
            const updatedRecord = {
                ...previousState[payload.id],
                ...payload.data,
            };

            const nextSiblings = meta.positionSource
                ? Object.keys(previousState)
                      .filter(
                          id =>
                              previousState[id][meta.parentSource] ===
                                  payload.data[meta.parentSource] &&
                              previousState[id][meta.positionSource] >=
                                  payload.data[meta.positionSource]
                      )
                      .map(id => ({
                          ...previousState[id],
                          [meta.positionSource]:
                              previousState[id][meta.positionSource] + 1,
                      }))
                : [];

            return addRecords([updatedRecord, ...nextSiblings], previousState);
        }
        if (meta.fetch === UPDATE_MANY) {
            const updatedRecords = payload.ids.map(id => ({
                ...previousState[id],
                ...payload.data,
            }));
            return addRecords(updatedRecords, previousState);
        }
        if (meta.fetch === DELETE) {
            return removeRecords([payload.id], previousState);
        }
        if (meta.fetch === DELETE_MANY) {
            return removeRecords(payload.ids, previousState);
        }
    }
    if (!meta || !meta.fetchResponse || meta.fetchStatus !== FETCH_END) {
        return previousState;
    }

    switch (meta.fetchResponse) {
        case GET_TREE_ROOT_NODES:
        case GET_TREE_CHILDREN_NODES:
        case GET_LIST:
        case GET_MANY:
        case GET_MANY_REFERENCE:
            return addRecords(payload.data, previousState);
        case GET_ONE:
        case UPDATE:
        case CREATE:
            return addRecords([payload.data], previousState);
        default:
            return previousState;
    }
};

export const getRecord = (state, id) => state[id];

export default dataReducer;
