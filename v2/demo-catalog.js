const demoImages=[1,2,3,5,6,7,8,9,11,12,14,15,16,18,19,20,22,23,24,25,26,27,28,31];
// Distinct *illustrative* content types, using the original prototype media.
// Never publish these fixtures to peers or represent them as signed content.
const demoSpecs=[
  {type:'image',title:'The cardboard-box expert',text:'Cats can turn almost any box into a favorite hiding place.',tags:['cats','photo','funny']},
  {type:'event',title:'Neighborhood photo walk and meetup',text:'Come share pictures and compare lenses. The event format demonstrates native dates and locations.',tags:['meetup','photography'],schedule:{start:'2027-05-14T15:30',end:'2027-05-14T17:30',location:'Community park'}},
  {type:'poll',title:'Which picture should we feature?',text:'An example of a poll attached to an ordinary image post.',tags:['poll','photography'],poll:{question:'Choose a picture',options:['First image','Second image','Third image']}},
  {type:'video',title:'A tiny motion study',text:'An example media-rich post. The original prototype includes a short clip.',tags:['video','animation'],video:'../thumb/thumb04.mp4'},
  {type:'job',title:'Illustrator wanted for an open project',text:'People can volunteer to help with designs and graphics.',tags:['help-wanted','art'],positions:['Illustrator','Layout designer']},
  {type:'project',title:'Build a little community gallery',text:'A project can describe its goals and ask for collaborators without inventing a separate site database.',tags:['open-source','project'],positions:['Tester','Developer']},
  {type:'offer',title:'Second-hand camera and accessories',text:'Example of a marketplace listing. Listings use the same portable record format.',tags:['marketplace','photography'],price:'$25, negotiable'},
  {type:'discussion',title:'What makes a small internet community work?',text:'A longer written discussion can use a full-row preview in Mixed or Blog view. Members should choose their own moderation and presentation preferences while every signed publication remains independently portable.',tags:['discussion','community'],noThumb:true},
  {type:'image',title:'A strange found object',text:'An interesting shape worth sharing.',tags:['image','found']},
  {type:'event',title:'Weekend art swap',text:'Bring a piece you made and trade with someone.',tags:['art','event'],schedule:{start:'2027-06-02T11:00',location:'Open-air market'}},
  {type:'poll',title:'Favorite color palette?',text:'A simple poll that can coexist with the image gallery.',tags:['design','poll'],poll:{question:'Which mood?',options:['Warm','Cold','Chaotic']}},
  {type:'image',title:'Big sky, small city',text:'A media post with normal captions and tags.',tags:['landscape','photo']},
  {type:'offer',title:'Swap a box of old computer parts',text:'Example of an informal trade listing.',tags:['electronics','marketplace'],price:'Swap'},
  {type:'project',title:'Archive a tiny piece of internet history',text:'Document the history without claiming exclusive ownership of a shared namespace.',tags:['archive','community']},
  {type:'job',title:'Looking for organizers',text:'Use structured positions for small voluntary groups.',tags:['organize','help-wanted'],positions:['Organizer','Writer','Moderator candidate']},
  {type:'image',title:'Unexpected design detail',text:'An image-first example with a short explanation.',tags:['architecture','details']},
  {type:'discussion',title:'How should open moderation be audited?',text:'Anyone can inspect the signed reasoning, refuse to follow a steward, and still independently retrieve the underlying post from willing mirrors.',tags:['discussion','transparency'],noThumb:true},
  {type:'event',title:'Electronics workshop',text:'Share ideas and bring a prototype.',tags:['workshop','electronics'],schedule:{start:'2027-07-22T14:00',location:'Local makerspace'}},
  {type:'poll',title:'What should we build next?',text:'Groups can suggest what to prioritize.',tags:['poll','planning'],poll:{question:'Pick a project',options:['Music player','Gallery','Board game','Documentation']}},
  {type:'image',title:'An old illustration',text:'Post format supports illustrations and multiple images.',tags:['illustration','art']},
  {type:'project',title:'Open music collaboration',text:'A community project can have open roles and supporting files.',tags:['music','collaboration'],positions:['Musician','Editor']},
  {type:'discussion',title:'A long-form note, not another thumbnail',text:'The Mixed layout uses a wider text preview for discussion and blog-like posts, while the original compact picture grid remains the default.',tags:['blog','ideas'],noThumb:true},
  {type:'offer',title:'Giving away unused art supplies',text:'A sample offer; no checkout, price feed or buyer verification is implied.',tags:['free','marketplace'],price:'Free'},
  {type:'image',title:'One final photo for the gallery',text:'Illustrative example. Real contributions are cryptographically signed and propagated only by the peers users choose.',tags:['cats','gallery']}
];

export const DEMO_CATALOG=demoSpecs.map((spec,i)=>({
  ...spec, imageFile:spec.noThumb?null:'thumb/thumb'+String(demoImages[i]).padStart(2,'0')+'.jpg',
  ordinal:i+1
}));