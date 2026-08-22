import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g8-u11-science-technology',
  curriculumFamily: 'global-success',
  grade: 8,
  unitNumber: 11,
  title: 'Grammar Grade 8 - Unit 11: Science and Technology',
  description:
    'Bài giảng Unit 11 Global Success 8 về Reported Speech: statements, questions, backshift, pronouns, time expressions và từ vựng khoa học công nghệ.',
  createdAt: '2026-05-15T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 8',
      subtitle: 'UNIT 11: SCIENCE AND TECHNOLOGY',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'REPORTED SPEECH - STATEMENTS',
          subtitle: '(Câu tường thuật - Câu kể)',
          accent: 'orange',
        },
        {
          title: 'BACKSHIFT & TIME EXPRESSIONS',
          subtitle: '(Lùi thì, đại từ, trạng từ)',
          accent: 'pink',
        },
        {
          title: 'REPORTED QUESTIONS',
          subtitle: '(Câu hỏi gián tiếp)',
          accent: 'blue',
        },
        {
          title: 'VOCABULARY & PRACTICE',
          subtitle: '(Science and Technology)',
          accent: 'green',
        },
      ],
    },
    {
      id: 's2',
      title: 'Mục tiêu bài học',
      layout: 'objectives',
      accent: 'blue',
      bullets: [
        {
          content: [
            { text: 'Phân biệt ' },
            { text: 'Direct Speech', accent: 'orange', bold: true },
            { text: ' và ' },
            { text: 'Reported Speech', accent: 'pink', bold: true },
          ],
        },
        {
          content: [
            { text: 'Dùng đúng ' },
            { text: 'said / told', accent: 'blue', bold: true },
            { text: ' trong câu tường thuật' },
          ],
        },
        {
          content: [
            { text: 'Áp dụng quy tắc ' },
            { text: 'lùi thì', accent: 'green', bold: true },
            { text: ', đổi đại từ và trạng từ' },
          ],
        },
        {
          content: [
            { text: 'Chuyển ' },
            { text: 'Yes/No questions', accent: 'purple', bold: true },
            { text: ' và ' },
            { text: 'Wh- questions', accent: 'purple', bold: true },
            { text: ' sang câu gián tiếp' },
          ],
        },
        {
          content: [
            { text: 'Sử dụng từ vựng chủ đề ' },
            { text: 'Science and Technology', accent: 'orange', bold: true },
            { text: ' trong bài tập' },
          ],
        },
      ],
    },
    {
      id: 's3',
      title: 'REPORTED SPEECH',
      subtitle: 'Statements - Câu tường thuật / Câu kể',
      label: 'Phần 1',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'Direct Speech vs Reported Speech',
      subtitle: 'Từ lời nói nguyên văn sang lời nói gián tiếp.',
      layout: 'explain',
      accent: 'orange',
      sections: [
        {
          title: 'Direct Speech',
          accent: 'orange',
          content: 'Thuật lại nguyên văn lời nói của người khác trong dấu ngoặc kép.',
          example: '"I love science."',
        },
        {
          title: 'Reported Speech',
          accent: 'pink',
          content: 'Thuật lại nội dung bằng lời của mình, không dùng dấu ngoặc kép.',
          example: 'Nam said (that) he loved science.',
        },
        {
          title: 'Điểm thay đổi',
          accent: 'blue',
          bullets: ['Bỏ dấu ngoặc kép', 'Lùi thì khi cần', 'Đổi đại từ và trạng từ theo ngữ cảnh'],
        },
        {
          title: 'Ghi nhớ',
          accent: 'green',
          content: 'Reported Speech giữ ý chính của câu gốc, nhưng thay hình thức câu cho phù hợp.',
        },
      ],
    },
    {
      id: 's5',
      title: 'Công thức cơ bản',
      subtitle: 'Ba cách mở đầu câu tường thuật thường gặp.',
      layout: 'explain',
      accent: 'blue',
      sections: [
        {
          title: 'say',
          accent: 'blue',
          content: [
            { text: 'S + said (that) + S + ' },
            { text: 'V lùi thì', accent: 'blue', bold: true },
          ],
          example: 'She said (that) she was a scientist.',
        },
        {
          title: 'say to',
          accent: 'purple',
          content: 'S + said to + O + (that) + S + V',
          example: 'He said to me that I was smart.',
        },
        {
          title: 'tell',
          accent: 'green',
          content: [
            { text: 'S + told + ' },
            { text: 'O', accent: 'green', bold: true },
            { text: ' + (that) + S + V' },
          ],
          example: 'She told us they had invented a robot.',
        },
        {
          title: 'Lưu ý quan trọng',
          accent: 'red',
          bullets: [
            'tell bắt buộc có tân ngữ',
            'say không cần tân ngữ',
            'Không viết: She said me that...',
          ],
        },
      ],
    },
    {
      id: 's6',
      title: 'BACKSHIFT OF TENSES',
      subtitle: 'Quy tắc lùi thì',
      label: 'Phần 2',
      layout: 'section-cover',
      accent: 'pink',
    },
    {
      id: 's7',
      title: 'Bảng lùi thì cần nhớ',
      subtitle: 'Khi động từ giới thiệu ở quá khứ: said / told.',
      layout: 'cards',
      accent: 'pink',
      cards: [
        {
          title: 'Present → Past',
          accent: 'blue',
          content: 'Simple Present → Simple Past',
          example: 'use AI → used AI',
        },
        {
          title: 'Present Continuous',
          accent: 'purple',
          content: 'am/is/are + V-ing → was/were + V-ing',
          example: 'are developing → were developing',
        },
        {
          title: 'Perfect / Past',
          accent: 'pink',
          content: 'Simple Past hoặc Present Perfect → Past Perfect',
          example: 'has created → had created',
        },
        {
          title: 'Modal verbs',
          accent: 'green',
          bullets: ['will → would', 'can → could', 'may → might', 'must → had to'],
          example: 'AI will change education → AI would change education',
        },
      ],
    },
    {
      id: 's8',
      title: 'Khi nào không lùi thì?',
      subtitle: 'Không phải câu nào cũng cần backshift.',
      layout: 'explain',
      accent: 'green',
      sections: [
        {
          title: 'Chân lý khoa học',
          accent: 'green',
          content: 'Sự thật hiển nhiên hoặc quy luật khoa học giữ nguyên thì.',
          example: 'She said the Earth revolves around the Sun.',
        },
        {
          title: 'Sự thật vẫn còn đúng',
          accent: 'blue',
          content: 'Nếu thông tin vẫn đúng ở hiện tại, có thể giữ nguyên thì.',
          example: 'She said she lives in Ha Noi.',
        },
        {
          title: 'Động từ giới thiệu ở hiện tại',
          accent: 'purple',
          content: 'Với says / tells, thì trong câu được thuật lại không đổi.',
          example: 'She says science is exciting.',
        },
        {
          title: 'Quy tắc nhanh',
          accent: 'orange',
          content:
            'said / told ở quá khứ → thường lùi thì. says / tells ở hiện tại → giữ nguyên thì.',
        },
      ],
    },
    {
      id: 's9',
      title: 'PRONOUNS & TIME EXPRESSIONS',
      subtitle: 'Thay đổi đại từ và trạng từ',
      label: 'Phần 3',
      layout: 'section-cover',
      accent: 'blue',
    },
    {
      id: 's10',
      title: 'Đổi đại từ theo ngữ cảnh',
      subtitle: 'Đại từ thay đổi theo người nói và người nghe thực tế.',
      layout: 'cards',
      accent: 'blue',
      cards: [
        {
          title: 'I / me / my',
          accent: 'orange',
          content: 'Thường đổi theo người nói: he, she, him, her, his, her.',
          example: '"I invented it." → She said she had invented it.',
        },
        {
          title: 'we / us / our',
          accent: 'green',
          content: 'Thường đổi thành they / them / their.',
          example: '"Our team won." → He said their team had won.',
        },
        {
          title: 'you / your',
          accent: 'purple',
          content: 'Đổi theo người nghe: I, he, she, they, my, his, her, their.',
          example: '"You discovered it." → She told him he had discovered it.',
        },
        {
          title: 'this / these',
          accent: 'pink',
          content: 'this → that, these → those.',
          example: '"This app is useful." → He said that app was useful.',
        },
      ],
    },
    {
      id: 's11',
      title: 'Đổi trạng từ thời gian / nơi chốn',
      subtitle: 'Các từ chỉ thời gian và nơi chốn thường thay đổi khi tường thuật.',
      layout: 'cards',
      accent: 'purple',
      cards: [
        {
          title: 'here / now',
          accent: 'blue',
          bullets: ['here → there', 'now → then / at that time'],
          example: 'Scientists are working now → scientists were working then',
        },
        {
          title: 'today / yesterday',
          accent: 'orange',
          bullets: ['today → that day', 'yesterday → the day before'],
          example: 'We launched today → they had launched that day',
        },
        {
          title: 'tomorrow',
          accent: 'green',
          content: 'tomorrow → the next day / the following day',
          example: 'We will launch tomorrow → they would launch the next day',
        },
        {
          title: 'last / next / ago',
          accent: 'pink',
          bullets: [
            'last week → the previous week',
            'next week → the following week',
            'ago → before',
          ],
        },
      ],
    },
    {
      id: 's12',
      title: '4 bước chuyển đổi',
      subtitle: 'Từ Direct Speech sang Reported Speech.',
      layout: 'explain',
      accent: 'orange',
      sections: [
        {
          title: 'Bước 1',
          accent: 'orange',
          content: 'Xoá dấu ngoặc kép và thêm that nếu cần.',
        },
        {
          title: 'Bước 2',
          accent: 'pink',
          content: 'Lùi thì động từ trong câu được thuật lại.',
        },
        {
          title: 'Bước 3',
          accent: 'blue',
          content: 'Thay đổi đại từ nhân xưng theo người nói/người nghe.',
        },
        {
          title: 'Bước 4',
          accent: 'green',
          content: 'Thay trạng từ chỉ thời gian và nơi chốn.',
        },
      ],
    },
    {
      id: 's13',
      title: 'Ví dụ tổng hợp',
      subtitle: 'Áp dụng đủ 4 bước trong một câu.',
      layout: 'practice',
      accent: 'orange',
      bullets: [
        {
          content: 'Direct: Lan said, "I have just finished my science project today here."',
        },
        {
          content:
            'Reported: Lan said (that) she had just finished her science project that day there.',
        },
        {
          content: 'I → she | have finished → had finished | today → that day | here → there',
        },
      ],
      examples: ['Đổi đại từ', 'Lùi thì', 'Đổi trạng từ', 'Bỏ ngoặc kép'],
    },
    {
      id: 's14',
      title: 'COMMON MISTAKES',
      subtitle: 'Lỗi thường gặp và lưu ý quan trọng',
      label: 'Phần 4',
      layout: 'section-cover',
      accent: 'red',
    },
    {
      id: 's15',
      title: 'Lỗi thường gặp trong Statements',
      subtitle: 'Những lỗi học sinh hay mắc khi chuyển câu kể.',
      layout: 'cards',
      accent: 'red',
      cards: [
        {
          title: 'said / told',
          accent: 'red',
          content: 'Sai: She told that robots would replace humans.',
          example: 'Đúng: She told us that robots would replace humans.',
        },
        {
          title: 'Quên lùi thì',
          accent: 'orange',
          content: 'Sai: She said she is working on a new invention.',
          example: 'Đúng: She said she was working on a new invention.',
        },
        {
          title: 'Quên đổi đại từ',
          accent: 'purple',
          content: 'Sai: She said my robot had won the prize.',
          example: 'Đúng: She said her robot had won the prize.',
        },
        {
          title: 'Quên đổi trạng từ',
          accent: 'blue',
          content: 'Sai: She said they would finish tomorrow.',
          example: 'Đúng: She said they would finish the next day.',
        },
      ],
    },
    {
      id: 's16',
      title: 'Lưu ý đặc biệt',
      subtitle: 'Một số điểm dễ nhầm trong bài thi.',
      layout: 'explain',
      accent: 'red',
      sections: [
        {
          title: 'Past Perfect không lùi thêm',
          accent: 'red',
          content: 'Past Perfect đã là thì sâu nhất trong Reported Speech.',
          example: '"She had invented it." → He said she had invented it.',
        },
        {
          title: 'say / said / says',
          accent: 'blue',
          bullets: ['says / tells: không lùi thì', 'said / told: thường lùi thì'],
        },
        {
          title: 'tell cần object',
          accent: 'green',
          content: 'Sau told phải có người nghe: told me, told us, told Lan...',
        },
        {
          title: 'that có thể bỏ',
          accent: 'purple',
          content: 'Trong statements, that thường có thể có hoặc không.',
          example: 'She said (that) AI was amazing.',
        },
      ],
    },
    {
      id: 's17',
      title: 'REPORTED QUESTIONS',
      subtitle: 'Tường thuật câu hỏi',
      label: 'Phần 5',
      layout: 'section-cover',
      accent: 'blue',
    },
    {
      id: 's18',
      title: 'Reported Questions: Ý chính',
      subtitle: 'Câu hỏi gián tiếp dùng trật tự câu bình thường.',
      layout: 'explain',
      accent: 'blue',
      sections: [
        {
          title: 'Yes/No Questions',
          accent: 'blue',
          content: 'Dùng if hoặc whether để nối câu.',
          example: '"Is the robot autonomous?" → She asked if the robot was autonomous.',
        },
        {
          title: 'Wh- Questions',
          accent: 'purple',
          content: 'Giữ nguyên từ để hỏi: what, where, when, why, how...',
          example: '"What does AI do?" → She asked what AI did.',
        },
        {
          title: 'Trật tự từ',
          accent: 'green',
          content: 'Reported questions dùng S + V, không đảo ngữ như câu hỏi trực tiếp.',
        },
        {
          title: 'Không dùng do/does/did',
          accent: 'red',
          content: 'Bỏ trợ động từ do/does/did và chia động từ chính theo thì phù hợp.',
        },
      ],
    },
    {
      id: 's19',
      title: 'Yes/No Questions',
      subtitle: 'Dùng if / whether.',
      layout: 'explain',
      accent: 'blue',
      sections: [
        {
          title: 'Công thức',
          accent: 'blue',
          content: 'S + asked + O + if/whether + S + V',
        },
        {
          title: 'if / whether',
          accent: 'purple',
          content: 'Có thể dùng thay thế nhau. Whether trang trọng hơn.',
        },
        {
          title: 'Ví dụ 1',
          accent: 'green',
          content: '"Do you use AI in your research?"',
          example: 'The professor asked the student if he/she used AI in his/her research.',
        },
        {
          title: 'Ví dụ 2',
          accent: 'orange',
          content: '"Can this drone fly in bad weather?"',
          example: 'The reporter asked if that drone could fly in bad weather.',
        },
      ],
    },
    {
      id: 's20',
      title: 'Wh- Questions',
      subtitle: 'Giữ nguyên từ để hỏi.',
      layout: 'explain',
      accent: 'purple',
      sections: [
        {
          title: 'Công thức',
          accent: 'purple',
          content: 'S + asked + O + Wh-word + S + V',
        },
        {
          title: 'Wh- words',
          accent: 'blue',
          bullets: ['what', 'where', 'when', 'why', 'how', 'which', 'who'],
        },
        {
          title: 'Ví dụ 1',
          accent: 'green',
          content: '"Where did scientists find the new element?"',
          example: 'The student asked where scientists had found the new element.',
        },
        {
          title: 'Ví dụ 2',
          accent: 'orange',
          content: '"How does the AI system learn?"',
          example: 'The visitor asked how the AI system learned.',
        },
      ],
    },
    {
      id: 's21',
      title: 'Lỗi thường gặp với Reported Questions',
      subtitle: 'Reported questions không giống câu hỏi trực tiếp.',
      layout: 'cards',
      accent: 'red',
      cards: [
        {
          title: 'Giữ đảo ngữ',
          accent: 'red',
          content: 'Sai: She asked what can this robot do.',
          example: 'Đúng: She asked what this robot could do.',
        },
        {
          title: 'Thiếu if / whether',
          accent: 'orange',
          content: 'Sai: She asked AI learned from data.',
          example: 'Đúng: She asked if AI learned from data.',
        },
        {
          title: 'Dùng that cho Yes/No',
          accent: 'purple',
          content: 'Sai: He asked that this experiment was safe.',
          example: 'Đúng: He asked if this experiment was safe.',
        },
        {
          title: 'Còn dùng do/does/did',
          accent: 'blue',
          content: 'Sai: She asked where did the data come from.',
          example: 'Đúng: She asked where the data came from.',
        },
      ],
    },
    {
      id: 's22',
      title: 'SCIENCE AND TECHNOLOGY',
      subtitle: 'Từ vựng chuyên đề',
      label: 'Phần 6',
      layout: 'section-cover',
      accent: 'green',
    },
    {
      id: 's23',
      title: 'Vocabulary Focus',
      subtitle: 'Các nhóm từ hay đi với Reported Speech trong Unit 11.',
      layout: 'cards',
      accent: 'green',
      cards: [
        {
          title: 'Fields',
          accent: 'blue',
          bullets: ['artificial intelligence', 'robotics', 'nanotechnology', 'biotechnology'],
          example: 'She said AI would transform healthcare.',
        },
        {
          title: 'Technology',
          accent: 'purple',
          bullets: ['3D printing', 'smart device', 'self-driving car', 'virtual reality'],
          example: 'He said VR had changed gaming.',
        },
        {
          title: 'Science verbs',
          accent: 'green',
          bullets: ['invent', 'discover', 'develop', 'design', 'launch', 'test'],
          example: 'They said engineers were developing a new vaccine.',
        },
        {
          title: 'Reporting verbs',
          accent: 'orange',
          bullets: ['explain', 'announce', 'claim', 'admit', 'promise', 'warn'],
          example: 'He warned us that the chemical was dangerous.',
        },
      ],
    },
    {
      id: 's24',
      title: 'Practice',
      subtitle: 'Chuyển các câu sau sang Reported Speech.',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        {
          content: '"I have just invented a new type of battery." (Nam → Lan)',
        },
        {
          content: '"Are you interested in artificial intelligence?" (teacher → student)',
        },
        {
          content: '"What will you do with this technology?" (reporter → scientist)',
        },
        {
          content: '"Did the robot pass the safety test?" (manager → engineer)',
        },
      ],
      examples: [
        'Nam told Lan he had just invented a new type of battery.',
        'The teacher asked the student if he/she was interested in AI.',
        'The reporter asked the scientist what he/she would do with that technology.',
        'The manager asked the engineer if the robot had passed the safety test.',
      ],
    },
    {
      id: 's25',
      title: 'Tổng kết Unit 11',
      subtitle: 'Reported Speech trong chủ đề Science and Technology.',
      layout: 'practice',
      accent: 'green',
      bullets: [
        {
          content: [
            { text: 'Statements: ' },
            { text: 'said/told + (that) + S + V', accent: 'blue', bold: true },
          ],
        },
        {
          content: [
            { text: 'Yes/No Questions: ' },
            { text: 'asked + if/whether + S + V', accent: 'purple', bold: true },
          ],
        },
        {
          content: [
            { text: 'Wh- Questions: ' },
            { text: 'asked + Wh-word + S + V', accent: 'orange', bold: true },
          ],
        },
        {
          content: 'Luôn kiểm tra: lùi thì, đổi đại từ, đổi trạng từ, bỏ đảo ngữ.',
        },
      ],
      examples: ['Backshift', 'Pronouns', 'Time expressions', 'Normal word order'],
    },
  ],
};

export default deck;
