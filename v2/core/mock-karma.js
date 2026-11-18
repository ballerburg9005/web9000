/**
 * Explicitly local-only mock reputation for UI testing. These numbers are
 * NEVER stake, independently verified karma or anti-Sybil evidence. No
 * qualified OrbitDB index may accept output from this test provider.
 */
export const MOCK_KARMA_MIN_SCORE=10;
export class MockKarmaProvider {
  constructor({scores={},minimum=MOCK_KARMA_MIN_SCORE}={}){
    if(!Number.isSafeInteger(minimum)||minimum<1||minimum>100)
      throw Error('Mock score threshold must be 1..100');
    this.minimum=minimum;
    this._scores=new Map();
    if(scores&&typeof scores==='object'&&!Array.isArray(scores)){
      for(const [author,score] of Object.entries(scores))
        if(MockKarmaProvider.validIdentity(author)&&MockKarmaProvider.validScore(score))
          this._scores.set(author,score);
    }
  }
  static validIdentity(author){
    return typeof author==='string'&&/^ed25519:[A-Za-z0-9_-]{42,46}$/.test(author);
  }
  static validScore(value){return Number.isSafeInteger(value)&&value>=0&&value<=100;}
  scoreFor(author){return this._scores.get(author)||0;}
  isTestQualified(author){return this.scoreFor(author)>=this.minimum;}
  assign(author,score){
    if(!MockKarmaProvider.validIdentity(author))throw Error('Enter a valid ed25519 public identity');
    if(!MockKarmaProvider.validScore(score))throw Error('Mock score must be an integer from 0 to 100');
    this._scores.set(author,score);
    return {author,score,qualified:this.isTestQualified(author),mode:'SIMULATION ONLY'};
  }
  clear(author){this._scores.delete(author);}
  entries(){return [...this._scores].map(([author,score])=>({author,score}));}
  snapshot(){return {minimum:this.minimum,scores:Object.fromEntries(this._scores)};}
  // No result ever asserts independent verification or locked coins.
}
