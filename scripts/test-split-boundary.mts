import { stripExamBoilerplate } from '../server/examBoilerplate.ts';
import { splitExamPaperHeuristic } from '../server/importPaper.ts';

const sample = `中考第一次模拟考试（浙江卷）01
科  学
注意事项：
1 ．答卷前，考生务必将自己的姓名、准考证号填写在答题卡上。
一、选择题（本大题共15小题，每小题3分，共45分）
1．下列有关科学说法正确的是（  ）
A. 选项一
B. 选项二
2．关于浮力的说法，正确的是（  ）
A. 浮力方向竖直向上
二、解答题
3．（8分）小明研究滑块运动，测得数据如下：
3.2 米/秒
（1）实验前小明需要估测水平轨道上滑行长度 L。
4．请写出化学方程式：_______`;

const text = stripExamBoilerplate(sample);
const items = splitExamPaperHeuristic(sample);
console.log('count', items.length);
for (const [i, it] of items.entries()) {
  console.log(`\n#${i + 1} title=${it.title}`);
  console.log(it.stem.split('\n').slice(0, 3).join(' | '));
}
