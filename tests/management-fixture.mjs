import assert from 'node:assert/strict';
import {finalizeRemovals} from '../src/management.js';
// Advance the hold explicitly in scenarios that exercise completed deletion.
export async function completeDeletionHold(mf,id){
 const db=await mf.getD1Database('DB');assert.ok(await db.prepare('SELECT profile_id FROM learner_removals WHERE profile_id=?').bind(id).first(),'a seven-day deletion hold must exist');
 await db.prepare('UPDATE learner_removals SET delete_after=? WHERE profile_id=?').bind(new Date(Date.now()-1).toISOString(),id).run();await finalizeRemovals(db);
}
