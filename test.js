// Offline tests with synthetic data modelled on the portal's layout.
const assert = require('assert');
process.env.PORT = 0;
const { parseResult, detectGroup, rank, parseRolls } = require('./server.js');
const rows = [
 ['Translation of Holy Quran','49','','98','A+','PASS'],['Urdu','83','','84.69','B+','PASS'],
 ['English','96','','97.96','A+','PASS'],['Islamic Education','50','','100','A+','PASS'],
 ['Physics','80','','94.12','A+','PASS'],['Chemistry','84','','98.82','A+','PASS'],['Biology','84','','98.82','A+','PASS']];
const text = 'Roll No.\t710327\nName\tTEST STUDENT\nFather Name\tTEST FATHER\nInstitute Name\t201672-Test College\nResult Notification\n526';
const r = parseResult('710327', { text, rows });
assert.equal(r.name, 'TEST STUDENT'); assert.equal(r.marks, 526); assert.equal(r.sum, 526);
assert.equal(r.group, 'Pre-Medical'); assert.equal(r.percentage, 94.77); assert.equal(r.school_code, '201672');
assert.equal(parseResult('111111', { text, rows }).status, 'parse_error');
const g = n => detectGroup(n.map(x => ({ name: x })));
assert.equal(g(['Physics','Chemistry','Math']), 'Pre-Engineering');
assert.equal(g(['Physics','Chemistry','Biology']), 'Pre-Medical');
assert.equal(g(['Computer Science','Math','Statistics']), 'ICS');
assert.equal(g(['Economics','Math']), 'General Science');
assert.equal(g(['Accounting','Commerce','Economics','Business Mathematics']), 'I.Com');
assert.equal(g(['Urdu','Islamic Education','Physics','Statistics','Economics']), 'General Science');
assert.equal(g(['Biology','Chemistry','Home Management']), 'Home Economics');
assert.equal(g(['Civics','Psychology','Geography']), 'FA (Humanities/Arts)');
assert.equal(g(['Arabic','Islamic Studies']), 'Islamic Studies');
assert.equal(g(['Islamic Education','Urdu','English']), 'Group Unknown');
assert.equal(g(['Chemistry','Biology','Math']), 'Group Unknown');
const rk = rank([{status:'ok',marks:500,roll:'a'},{status:'ok',marks:500,roll:'b'},{status:'ok',marks:400,roll:'c'},{status:'failed'}]);
assert.deepEqual(rk.map(x => x.rank), [1,1,3]);
const p = parseRolls('\uFEFF1234\r\n\r\n1234\n abc\n5678 \r');
assert.deepEqual([p.valid, p.invalid, p.dup], [['1234','5678'],['abc'],1]);
const gz=parseRolls('Roll Number\tName of Candidate\tResult\n700001\tALISHA BIBI\t409\n700003\tAQSA BIBI\tBIO\n700001\tX\t1\nbad\tZ\t2');
assert.deepEqual([gz.valid, gz.invalid.length, gz.dup, gz.meta['700001'].result], [['700001','700003'],1,1,'409']);
const R2=[['Translation of Holy Quran','48','','96','A+','PASS'],['Urdu','85','','86.73','B+','PASS'],['English','96','','97.96','A+','PASS'],['Islamic Education','46','','92','A+','PASS'],['Physics','77','','90.59','A+','PASS'],['Chemistry','83','','97.65','A+','PASS'],['Biology','81','','95.29','A+','PASS']];
const H=[['BOARD OF INTERMEDIATE & SECONDARY EDUCATION, MULTAN'],['Roll No.','710341'],['Name','TEST YASIR'],['Father Name','TEST ASIF'],['Institute Name','201672-KIPS College for Boys Multan Jahanian Road, Near Nesco Factory, Jahanian'],['Subject Name','Obtained Marks'],['Theory','Practical'],...R2,['Result Notification','','516']];
const r2=parseResult('710341',{text:'Roll No.\t710341\nName\tTEST YASIR\nFather Name\tTEST ASIF\nInstitute Name\t201672-KIPS College',rows:H});
assert.equal(r2.name,'TEST YASIR'); assert.equal(r2.father,'TEST ASIF'); assert.equal(r2.marks,516); assert.equal(r2.sum,516);
assert.equal(r2.group,'Pre-Medical'); assert.equal(r2.percentage,92.97); assert.equal(r2.school_code,'201672'); assert.equal(r2.subjects.length,7);

// --- robustness: rows/groups must not silently disappear
{
  const mk = subs => ({ text: 'Roll No.\t900001\nName\tT ONE\nResult Notification\n400', rows: [['Roll No.','900001'],['Name','T ONE'],['Father Name','F'],['Institute Name','1-C'],['Subject Name','Theory','Practical','Percentile','Grade','Status'], ...subs, ['Result Notification','','400']] });
  const a = parseResult('900001', mk([['Physics (Theory+Practical)','60','18','70.1','A','PASS'],['Chemistry (Practical)','55','17','65','B','PASS'],['Mathematics','70','A+','PASS']]));
  assert.equal(a.subjects.length, 3, 'subjects with theory/practical in the name, and rows with one mark, must be kept'); assert.equal(a.group, 'Pre-Engineering');
  const b = parseResult('900001', mk([['PHY','60','18','70.1','A','PASS'],['CHEM','55','17','65','B','PASS'],['BIO','70','15','82.3','A+','PASS']]));
  assert.equal(b.group, 'Pre-Medical');
  assert.equal(g(['PHY','Math','CS']), 'ICS'); assert.equal(g(['Physics','Chemistry','Mathematics (Pre-Eng)']), 'Pre-Engineering');
  assert.equal(parseResult('900001', mk([])).status, 'parse_error');
}

// --- group audit: realistic subject combinations (compulsory subjects are added to every case)
{
  const C = ['Urdu', 'English', 'Islamic Education'];
  const cases = [
    ['Pre-Medical', ['Physics','Chemistry','Biology']], ['Pre-Medical', ['PHY','CHEM','BIO']], ['Pre-Engineering', ['Physics','Chemistry','Mathematics']],
    ['ICS', ['Physics','Computer Science','Mathematics']], ['ICS', ['Mathematics','Statistics','Computer Science']], ['ICS', ['Mathematics','Economics','Computer Science']],
    ['I.Com', ['Principles of Accounting','Principles of Commerce','Business Mathematics','Economics']], ['I.Com', ['Principles of Accounting','Principles of Commerce','Commercial Geography']],
    ['General Science', ['Mathematics','Statistics','Economics']], ['General Science', ['Physics','Mathematics','Statistics']],
    ['FA (Humanities/Arts)', ['Civics','Geography','Psychology']], ['FA (Humanities/Arts)', ['Economics','Civics','Education']], ['FA (Humanities/Arts)', ['Islamic Studies','Civics','Geography']],
    ['FA (Humanities/Arts)', ['General Mathematics','Civics','Geography']], ['FA (Humanities/Arts)', ['Education','Psychology','Fine Arts']], ['FA (Humanities/Arts)', ['Urdu Literature','English Literature','Persian']],
    ['FA (Humanities/Arts)', ['Arabic','Civics','Islamic Studies']], ['FA (Humanities/Arts)', ['Logic','Sociology','Library Science']], ['FA (Humanities/Arts)', ['Punjabi','Pakistan Culture','Geography']],
    ['Home Economics', ['Home Management','Clothing and Textile','Nutrition']], ['Home Economics', ['Home Economics','Child Development','Food and Nutrition']],
  ];
  for (const [exp, subs] of cases) assert.equal(g([...C, ...subs]), exp, subs.join(', '));
  // a subject the student was ABSENT in has no marks, but must still decide the group
  const ab = { text: 'Roll No.\t900002\nName\tT TWO\nResult Notification\n300', rows: [['Roll No.','900002'],['Name','T TWO'],['Father Name','F'],['Institute Name','1-C'],['Subject Name','Theory','Practical','Percentile','Grade','Status'],['Physics','60','18','70.1','A','PASS'],['Chemistry','55','17','65','B','PASS'],['Biology','','','','','ABSENT'],['Result Notification','','300']] };
  const ra = parseResult('900002', ab); assert.equal(ra.group, 'Pre-Medical'); assert.equal(ra.result, 'Absent'); assert.equal(ra.subjects.length, 3);
}


// --- districts of the Multan board (Multan, Khanewal, Lodhran, Vehari): last town named in the address wins
{
  const { districtOf } = require('./server.js'), d = i => districtOf({ institute: i });
  assert.equal(d('201672-GOVT. COLLEGE FOR WOMEN, MULTAN'), 'Multan');
  assert.equal(d('305-GOVT. COLLEGE, MULTAN ROAD, BUREWALA'), 'Vehari');
  assert.equal(d('11-Govt. Degree College Kabirwala'), 'Khanewal');
  assert.equal(d('12-Higher Secondary School Shujabad'), 'Multan');
  assert.equal(d('13-College Kahror Pakka District Lodhran'), 'Lodhran');
  assert.equal(d('14-Model College Mian Chunnu'), 'Khanewal');
  assert.equal(d('15-Some Institute With No Place'), '');
}
console.log('All offline tests passed'); process.exit(0);
