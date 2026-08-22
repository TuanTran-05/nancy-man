import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g9-u12-my-future-career',
  curriculumFamily: 'global-success',
  grade: 9,
  unitNumber: 12,
  title: 'Grammar Grade 9 - Unit 12: My Future Career',
  description:
    'Bài giảng Unit 12 Global Success 9 về adverbial clauses of concession, result, reason và từ vựng My Future Career.',
  createdAt: '2026-05-18T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 9',
      subtitle: 'UNIT 12: MY FUTURE CAREER',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'ADVERBIAL CLAUSES OF CONCESSION',
          subtitle: '(Mệnh đề trạng ngữ chỉ sự nhượng bộ)',
          accent: 'orange',
        },
        {
          title: 'ADVERBIAL CLAUSES OF RESULT',
          subtitle: '(Mệnh đề trạng ngữ chỉ kết quả)',
          accent: 'blue',
        },
        {
          title: 'ADVERBIAL CLAUSES OF REASON',
          subtitle: '(Mệnh đề trạng ngữ chỉ lý do)',
          accent: 'green',
        },
      ],
    },
    {
      id: 's2',
      title: 'Mục tiêu bài học',
      layout: 'objectives',
      bullets: [
        {
          content:
            'Dùng although, though, even though để nối hai ý trái ngược trong chủ đề nghề nghiệp.',
        },
        {
          content:
            'Dùng so...that, such...that và so that để diễn tả kết quả hoặc mục đích nghề nghiệp.',
        },
        {
          content:
            'Dùng because, since, as để giải thích lý do chọn nghề, học kỹ năng hoặc thay đổi kế hoạch.',
        },
        {
          content:
            'Viết câu đúng dấu câu, không dùng cặp nối sai như although...but hoặc because...so.',
        },
      ],
    },
    {
      id: 's3',
      title: 'Phần 1',
      subtitle: 'Adverbial Clauses of Concession',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'Mệnh đề nhượng bộ là gì?',
      subtitle: 'Dùng để diễn tả hai ý trái ngược nhau.',
      layout: 'cards',
      cards: [
        {
          title: 'Although',
          accent: 'orange',
          content: 'Mang nghĩa mặc dù, dùng phổ biến trong văn viết.',
          example: 'Although the job is challenging, I want to become a doctor.',
        },
        {
          title: 'Though',
          accent: 'blue',
          content: 'Mang nghĩa dù / mặc dù, tự nhiên hơn trong văn nói.',
          example: 'Though she is young, she has a clear career plan.',
        },
        {
          title: 'Even though',
          accent: 'pink',
          content: 'Nhấn mạnh sự đối lập mạnh hơn although.',
          example: 'Even though programming is difficult, he wants to become a software developer.',
        },
      ],
    },
    {
      id: 's5',
      title: 'Đứng đầu câu',
      subtitle: 'Khi mệnh đề nhượng bộ đứng đầu câu, dùng dấu phẩy.',
      layout: 'explain',
      accent: 'orange',
      formula: 'Although / Though / Even though + S + V, S + V.',
      bullets: [
        { content: 'Mệnh đề đầu nêu khó khăn, trở ngại hoặc ý trái ngược.' },
        { content: 'Mệnh đề sau nêu lựa chọn, quyết tâm hoặc kết quả thực tế.' },
        { content: 'Dấu phẩy đặt giữa hai mệnh đề.' },
      ],
      examples: [
        'Although the job is stressful, he enjoys it.',
        'Though my parents want me to be a doctor, I prefer design.',
        'Even though the salary is not high, she loves teaching.',
      ],
    },
    {
      id: 's6',
      title: 'Đứng giữa câu',
      subtitle: 'Khi although / though / even though đứng giữa câu, thường không cần dấu phẩy.',
      layout: 'explain',
      accent: 'orange',
      formula: 'S + V + although / though / even though + S + V.',
      bullets: [
        { content: 'Mệnh đề chính đứng trước.' },
        { content: 'Mệnh đề nhượng bộ đứng sau để bổ sung ý trái ngược.' },
        { content: 'Ý nghĩa không đổi so với khi đặt liên từ ở đầu câu.' },
      ],
      examples: [
        'I want to become a teacher although the job is not easy.',
        'She chose this career though her friends disagreed.',
        'He wants to work in technology even though it requires hard work.',
      ],
    },
    {
      id: 's7',
      title: 'Although / Though / Even though',
      subtitle: 'Ba từ nối gần nghĩa nhưng sắc thái khác nhau.',
      layout: 'cards',
      cards: [
        {
          title: 'Although',
          accent: 'orange',
          content: 'Trung tính, phù hợp văn viết và bài kiểm tra.',
          example: 'Although the job is hard, I like it.',
        },
        {
          title: 'Though',
          accent: 'blue',
          content: 'Tự nhiên, thường gặp trong giao tiếp.',
          example: 'Though it is difficult, I will try.',
        },
        {
          title: 'Even though',
          accent: 'pink',
          content: 'Nhấn mạnh rằng trở ngại khá lớn nhưng hành động vẫn xảy ra.',
          example: 'Even though the job is stressful, she wants it.',
        },
      ],
    },
    {
      id: 's8',
      title: 'Lỗi cần tránh',
      subtitle: 'Although / though / even though đã mang nghĩa đối lập.',
      layout: 'cards',
      cards: [
        {
          title: 'Không dùng thêm but',
          accent: 'red',
          content: 'Sai: Although the job is hard, but I like it.',
          example: 'Đúng: Although the job is hard, I like it.',
        },
        {
          title: 'Sau liên từ là mệnh đề',
          accent: 'orange',
          content: 'Cần có chủ ngữ và động từ sau although / though / even though.',
          example: 'Although the job is difficult, I will try my best.',
        },
        {
          title: 'Không dùng cụm danh từ trống',
          accent: 'pink',
          content: 'Sai: Although the difficult job, I will try.',
          example: 'Đúng: Although the job is difficult, I will try.',
        },
      ],
    },
    {
      id: 's9',
      title: 'Ví dụ theo chủ đề nghề nghiệp',
      subtitle: 'Dùng nhượng bộ để nói khó khăn nhưng vẫn quyết tâm.',
      layout: 'cards',
      cards: [
        {
          title: 'Doctor',
          accent: 'orange',
          content: 'Although becoming a doctor takes many years, I still want to do it.',
        },
        {
          title: 'Nurse',
          accent: 'blue',
          content: 'Even though the job is stressful, she wants to become a nurse.',
        },
        {
          title: 'Designer',
          accent: 'pink',
          content: 'Though design is competitive, he wants to build a creative career.',
        },
      ],
    },
    {
      id: 's10',
      title: 'Luyện tập: Concession',
      subtitle: 'Chọn từ nối phù hợp và sửa lỗi nếu cần.',
      layout: 'practice',
      accent: 'orange',
      sections: [
        {
          title: 'Bài 1',
          content: '_____ the interview was difficult, I stayed calm.',
          example: 'Although / Though / Even though',
        },
        {
          title: 'Bài 2',
          content: 'Sửa lỗi: Although the salary is low, but she loves teaching.',
          example: 'Although the salary is low, she loves teaching.',
        },
        {
          title: 'Bài 3',
          content: 'Viết lại: The job is demanding. He still wants to apply for it.',
          example: 'Although the job is demanding, he still wants to apply for it.',
        },
      ],
    },
    {
      id: 's11',
      title: 'Phần 2',
      subtitle: 'Adverbial Clauses of Result',
      layout: 'section-cover',
      accent: 'blue',
    },
    {
      id: 's12',
      title: 'Mệnh đề kết quả là gì?',
      subtitle: 'Dùng để nói một sự việc dẫn đến kết quả gì.',
      layout: 'cards',
      cards: [
        {
          title: 'so + adj / adv + that',
          accent: 'blue',
          content: 'Nhấn mạnh tính từ hoặc trạng từ.',
          example: 'The job is so interesting that many students want to try it.',
        },
        {
          title: 'such + noun phrase + that',
          accent: 'purple',
          content: 'Nhấn mạnh cụm danh từ.',
          example: 'It is such an interesting job that many people apply for it.',
        },
        {
          title: 'so that',
          accent: 'green',
          content: 'Nói mục đích hoặc kết quả mong muốn.',
          example: 'I study English so that I can get a good job.',
        },
      ],
    },
    {
      id: 's13',
      title: 'So + adjective / adverb + that',
      subtitle: 'Dùng so để nhấn mạnh mức độ của tính từ hoặc trạng từ.',
      layout: 'explain',
      accent: 'blue',
      formula: 'S + be / V + so + adjective / adverb + that + S + V.',
      bullets: [
        { content: 'Sau so là tính từ hoặc trạng từ, không phải danh từ.' },
        { content: 'Sau that là mệnh đề chỉ kết quả.' },
        { content: 'Có thể dùng với be hoặc động từ thường.' },
      ],
      examples: [
        'The course is so useful that many students join it.',
        'She studies so hard that she can pass the entrance exam.',
        'He is so creative that he wants to become a designer.',
      ],
    },
    {
      id: 's14',
      title: 'So với tính từ',
      subtitle: 'Dùng khi mô tả tính chất của người, khóa học hoặc công việc.',
      layout: 'cards',
      cards: [
        {
          title: 'Interesting',
          accent: 'blue',
          content: 'The job is so interesting that I want to learn more about it.',
        },
        {
          title: 'Demanding',
          accent: 'purple',
          content: 'The job is so demanding that not everyone can do it.',
        },
        {
          title: 'Creative',
          accent: 'green',
          content: 'He is so creative that he wants to become a designer.',
        },
      ],
    },
    {
      id: 's15',
      title: 'So với trạng từ',
      subtitle: 'Dùng khi nhấn mạnh cách ai đó làm việc hoặc học tập.',
      layout: 'cards',
      cards: [
        {
          title: 'Hard',
          accent: 'blue',
          content: 'She studies so hard that she can achieve her career goals.',
        },
        {
          title: 'Carefully',
          accent: 'green',
          content: 'He works so carefully that his boss trusts him.',
        },
        {
          title: 'Confidently',
          accent: 'purple',
          content: 'She speaks so confidently that she passes the interview.',
        },
      ],
    },
    {
      id: 's16',
      title: 'Such + noun phrase + that',
      subtitle: 'Dùng such khi phần được nhấn mạnh là một cụm danh từ.',
      layout: 'explain',
      accent: 'purple',
      formula: 'S + be / V + such + noun phrase + that + S + V.',
      bullets: [
        { content: 'Với danh từ số ít: such + a / an + adjective + singular noun + that.' },
        { content: 'Với danh từ số nhiều: such + adjective + plural noun + that.' },
        { content: 'Với danh từ không đếm được: such + adjective + uncountable noun + that.' },
      ],
      examples: [
        'It is such an interesting job that many people apply for it.',
        'They are such useful skills that everyone should learn them.',
        'It was such important advice that I followed it carefully.',
      ],
    },
    {
      id: 's17',
      title: 'Ba dạng với Such',
      subtitle: 'Chọn a / an hoặc bỏ a / an tùy danh từ phía sau.',
      layout: 'cards',
      cards: [
        {
          title: 'Singular noun',
          accent: 'purple',
          content: 'such + a / an + adjective + singular noun',
          example: 'She is such a hard-working student that her teachers admire her.',
        },
        {
          title: 'Plural noun',
          accent: 'blue',
          content: 'such + adjective + plural noun',
          example: 'They are such useful skills that students need them.',
        },
        {
          title: 'Uncountable noun',
          accent: 'green',
          content: 'such + adjective + uncountable noun',
          example: 'It was such important advice that I followed it carefully.',
        },
      ],
    },
    {
      id: 's18',
      title: 'So hay Such?',
      subtitle: 'Nhìn từ ngay sau so / such để chọn cấu trúc.',
      layout: 'cards',
      cards: [
        {
          title: 'SO',
          accent: 'blue',
          content: 'so + adjective / adverb + that',
          example: 'The job is so difficult that I must study hard.',
        },
        {
          title: 'SUCH',
          accent: 'purple',
          content: 'such + noun phrase + that',
          example: 'It is such a difficult job that I must study hard.',
        },
        {
          title: 'Mẹo nhớ',
          accent: 'orange',
          content: 'Nếu sau từ cần điền có danh từ chính, thường nghĩ đến such.',
          example: 'such a useful course / so useful',
        },
      ],
    },
    {
      id: 's19',
      title: 'So that',
      subtitle: 'Dùng để nói mục đích hoặc kết quả mong muốn.',
      layout: 'explain',
      accent: 'green',
      formula: 'S + V + so that + S + can / could / will / would + V.',
      bullets: [
        { content: 'So that thường trả lời câu hỏi: để làm gì?' },
        { content: 'Dùng can / will cho hiện tại hoặc tương lai.' },
        { content: 'Dùng could / would khi nói về quá khứ hoặc tình huống ít trực tiếp hơn.' },
      ],
      examples: [
        'I study English hard so that I can get a good job.',
        'She learns coding so that she can become a software developer.',
        'He practised interview skills so that he could feel more confident.',
      ],
    },
    {
      id: 's20',
      title: 'So that trong chủ đề nghề nghiệp',
      subtitle: 'Nối hành động học tập với mục tiêu nghề nghiệp.',
      layout: 'cards',
      cards: [
        {
          title: 'English',
          accent: 'green',
          content: 'I study English so that I can work for an international company.',
        },
        {
          title: 'Coding',
          accent: 'blue',
          content: 'She learns coding so that she can become a software developer.',
        },
        {
          title: 'Interview skills',
          accent: 'purple',
          content: 'He practises speaking so that he can pass the interview.',
        },
      ],
    },
    {
      id: 's21',
      title: 'Ví dụ kết quả chi tiết',
      subtitle: 'Xác định phần nhấn mạnh và kết quả.',
      layout: 'cards',
      cards: [
        {
          title: 'So hard-working',
          accent: 'blue',
          content: 'She is so hard-working that she can achieve her career goals.',
          example: 'Nhấn mạnh tính chăm chỉ.',
        },
        {
          title: 'Such a useful course',
          accent: 'purple',
          content: 'It is such a useful course that many students want to join it.',
          example: 'Nhấn mạnh cụm danh từ a useful course.',
        },
        {
          title: 'So that',
          accent: 'green',
          content: 'I learn English so that I can work abroad.',
          example: 'Nói mục đích học tiếng Anh.',
        },
      ],
    },
    {
      id: 's22',
      title: 'Luyện tập: So / Such / So that',
      subtitle: 'Điền cấu trúc đúng vào chỗ trống.',
      layout: 'practice',
      accent: 'blue',
      sections: [
        {
          title: 'Câu 1',
          content: 'The course is _____ useful that many students join it.',
          example: 'so',
        },
        {
          title: 'Câu 2',
          content: 'It is _____ an important skill that everyone should practise it.',
          example: 'such',
        },
        {
          title: 'Câu 3',
          content: 'I take a coding course _____ I can become a software developer.',
          example: 'so that',
        },
      ],
    },
    {
      id: 's23',
      title: 'Viết lại câu với kết quả',
      subtitle: 'Giữ nguyên ý nghĩa của câu.',
      layout: 'practice',
      accent: 'purple',
      sections: [
        {
          title: 'Từ so sang such',
          content: 'The job is so meaningful that many people choose it.',
          example: 'It is such a meaningful job that many people choose it.',
        },
        {
          title: 'Từ such sang so',
          content: 'She is such a creative designer that many companies want to hire her.',
          example: 'She is so creative that many companies want to hire her as a designer.',
        },
        {
          title: 'Mục đích',
          content: 'He improves his English. He wants to work abroad.',
          example: 'He improves his English so that he can work abroad.',
        },
      ],
    },
    {
      id: 's24',
      title: 'Phần 3',
      subtitle: 'Adverbial Clauses of Reason',
      layout: 'section-cover',
      accent: 'green',
    },
    {
      id: 's25',
      title: 'Mệnh đề lý do là gì?',
      subtitle: 'Dùng để giải thích vì sao một sự việc xảy ra.',
      layout: 'cards',
      cards: [
        {
          title: 'Because',
          accent: 'green',
          content: 'Đưa ra lý do rõ ràng và trực tiếp.',
          example: 'I want to become a teacher because I love working with children.',
        },
        {
          title: 'Since',
          accent: 'blue',
          content: 'Dùng khi lý do đã rõ hoặc ít được nhấn mạnh hơn.',
          example: 'Since technology is developing fast, many students want to learn coding.',
        },
        {
          title: 'As',
          accent: 'purple',
          content: 'Trang trọng hơn, thường đứng đầu câu.',
          example: 'As she is good at drawing, she wants to become a designer.',
        },
      ],
    },
    {
      id: 's26',
      title: 'Because',
      subtitle: 'Because nhấn mạnh lý do trực tiếp.',
      layout: 'explain',
      accent: 'green',
      formula: 'S + V + because + S + V. / Because + S + V, S + V.',
      bullets: [
        { content: 'Có thể đặt because ở giữa câu hoặc đầu câu.' },
        { content: 'Nếu đặt mệnh đề because ở đầu câu, dùng dấu phẩy.' },
        { content: 'Because thường trả lời câu hỏi Why?' },
      ],
      examples: [
        'I want to become a doctor because I want to help people.',
        'She chose this job because it matches her skills.',
        'Because he loves technology, he wants to become an engineer.',
      ],
    },
    {
      id: 's27',
      title: 'Since và As',
      subtitle: 'Dùng khi lý do đã rõ hoặc ít cần nhấn mạnh.',
      layout: 'explain',
      accent: 'blue',
      formula: 'Since / As + S + V, S + V.',
      bullets: [
        { content: 'Since và as thường đứng đầu câu.' },
        { content: 'Mệnh đề lý do đứng đầu câu cần dấu phẩy.' },
        { content: 'As thường trang trọng hơn trong văn viết.' },
      ],
      examples: [
        'Since she is good at communication, she wants to become a tour guide.',
        'As he likes solving problems, he wants to be an engineer.',
        'Since the job requires English, I need to improve my speaking skills.',
      ],
    },
    {
      id: 's28',
      title: 'Because / Since / As',
      subtitle: 'Chọn từ nối theo mức độ nhấn mạnh lý do.',
      layout: 'cards',
      cards: [
        {
          title: 'Because',
          accent: 'green',
          content: 'Nhấn mạnh lý do rõ ràng.',
          example: 'I chose this job because I like science.',
        },
        {
          title: 'Since',
          accent: 'blue',
          content: 'Lý do đã biết hoặc ít nhấn mạnh hơn.',
          example: 'Since I like children, I want to teach.',
        },
        {
          title: 'As',
          accent: 'purple',
          content: 'Trang trọng hơn, thường đứng đầu câu.',
          example: 'As he is creative, he wants to design games.',
        },
      ],
    },
    {
      id: 's29',
      title: 'Lỗi cần tránh với Reason',
      subtitle: 'Không dùng hai từ nối chỉ nguyên nhân - kết quả trong cùng một câu.',
      layout: 'cards',
      cards: [
        {
          title: 'Because + so',
          accent: 'red',
          content: 'Sai: Because I like technology, so I want to be an engineer.',
          example: 'Đúng: Because I like technology, I want to be an engineer.',
        },
        {
          title: 'Dùng so riêng',
          accent: 'orange',
          content: 'Có thể tách thành câu nguyên nhân - kết quả với so.',
          example: 'I like technology, so I want to be an engineer.',
        },
        {
          title: 'Dấu phẩy',
          accent: 'green',
          content: 'Nếu mệnh đề lý do đứng đầu câu, đặt dấu phẩy sau mệnh đề đó.',
          example: 'Since she wants to be a doctor, she studies biology carefully.',
        },
      ],
    },
    {
      id: 's30',
      title: 'Ví dụ lý do chọn nghề',
      subtitle: 'Dùng reason clauses để giải thích lựa chọn nghề nghiệp.',
      layout: 'cards',
      cards: [
        {
          title: 'Software developer',
          accent: 'green',
          content: 'I want to become a software developer because I enjoy coding.',
        },
        {
          title: 'Nurse',
          accent: 'blue',
          content: 'As she is patient and caring, she wants to become a nurse.',
        },
        {
          title: 'Tour guide',
          accent: 'purple',
          content: 'Since he has good communication skills, he wants to become a tour guide.',
        },
      ],
    },
    {
      id: 's31',
      title: 'Luyện tập: Reason',
      subtitle: 'Hoàn thành câu bằng because, since hoặc as.',
      layout: 'practice',
      accent: 'green',
      sections: [
        {
          title: 'Câu 1',
          content: 'I want to become a chef _____ I love cooking.',
          example: 'because',
        },
        {
          title: 'Câu 2',
          content: '_____ communication skills are important, students should practise speaking.',
          example: 'Since / As',
        },
        {
          title: 'Câu 3',
          content: 'Sửa lỗi: Because she likes science, so she wants to be a scientist.',
          example: 'Because she likes science, she wants to be a scientist.',
        },
      ],
    },
    {
      id: 's32',
      title: 'So sánh 3 loại mệnh đề',
      subtitle: 'Mỗi loại trả lời một câu hỏi khác nhau.',
      layout: 'cards',
      cards: [
        {
          title: 'Concession',
          accent: 'orange',
          content: 'Mặc dù điều gì?',
          example: 'Although the job is hard, I like it.',
        },
        {
          title: 'Result',
          accent: 'blue',
          content: 'Kết quả là gì?',
          example: 'She is so hard-working that she succeeds.',
        },
        {
          title: 'Reason',
          accent: 'green',
          content: 'Vì sao?',
          example: 'I choose this job because I love science.',
        },
      ],
    },
    {
      id: 's33',
      title: 'Nhận diện nhanh',
      subtitle: 'Nhìn từ nối để xác định chức năng trong câu.',
      layout: 'cards',
      cards: [
        {
          title: 'although / though / even though',
          accent: 'orange',
          content: 'Báo hiệu ý trái ngược hoặc nhượng bộ.',
        },
        {
          title: 'so...that / such...that',
          accent: 'blue',
          content: 'Báo hiệu mức độ dẫn đến kết quả.',
        },
        {
          title: 'because / since / as',
          accent: 'green',
          content: 'Báo hiệu lý do.',
        },
        {
          title: 'so that',
          accent: 'purple',
          content: 'Báo hiệu mục đích hoặc kết quả mong muốn.',
        },
      ],
    },
    {
      id: 's34',
      title: 'Lỗi thường gặp',
      subtitle: 'Các lỗi dễ mất điểm trong bài viết.',
      layout: 'cards',
      cards: [
        {
          title: 'Although...but',
          accent: 'red',
          content: 'Sai: Although the job is hard, but I like it.',
          example: 'Đúng: Although the job is hard, I like it.',
        },
        {
          title: 'Because...so',
          accent: 'red',
          content: 'Sai: Because I like science, so I choose this job.',
          example: 'Đúng: Because I like science, I choose this job.',
        },
        {
          title: 'So / Such',
          accent: 'orange',
          content: 'Sai: It is so useful course that I join it.',
          example: 'Đúng: It is such a useful course that I join it.',
        },
      ],
    },
    {
      id: 's35',
      title: 'Từ vựng: Nghề nghiệp',
      subtitle: 'Các nghề thường dùng trong Unit 12.',
      layout: 'cards',
      cards: [
        {
          title: 'Healthcare',
          accent: 'green',
          content: 'doctor, nurse',
          example: 'A nurse takes care of patients.',
        },
        {
          title: 'Education and science',
          accent: 'blue',
          content: 'teacher, scientist, engineer',
          example: 'An engineer designs machines and systems.',
        },
        {
          title: 'Creative and service jobs',
          accent: 'purple',
          content: 'designer, chef, journalist, tour guide',
          example: 'A designer needs creativity.',
        },
        {
          title: 'Technology',
          accent: 'orange',
          content: 'software developer',
          example: 'A software developer writes computer programs.',
        },
      ],
    },
    {
      id: 's36',
      title: 'Từ vựng: Kỹ năng nghề nghiệp',
      subtitle: 'Dùng để giải thích vì sao một nghề phù hợp.',
      layout: 'cards',
      cards: [
        {
          title: 'Soft skills',
          accent: 'green',
          content: 'communication skills, teamwork, leadership',
          example: 'Tour guides need good communication skills.',
        },
        {
          title: 'Thinking skills',
          accent: 'blue',
          content: 'problem-solving, creativity',
          example: 'Engineers need problem-solving skills.',
        },
        {
          title: 'Personal qualities',
          accent: 'purple',
          content: 'confidence, responsibility, patience',
          example: 'Teachers need patience.',
        },
      ],
    },
    {
      id: 's37',
      title: 'Từ vựng: Hoạt động nghề nghiệp',
      subtitle: 'Các cụm động từ dùng trong bài nói và bài viết.',
      layout: 'cards',
      cards: [
        {
          title: 'Prepare',
          accent: 'green',
          content: 'choose a career, prepare a CV, attend an interview',
          example: 'We should prepare a clear CV.',
        },
        {
          title: 'Develop',
          accent: 'blue',
          content: 'gain experience, take a course, improve skills',
          example: 'Part-time jobs help students gain experience.',
        },
        {
          title: 'Aim',
          accent: 'purple',
          content: 'work abroad, start a business, achieve a goal',
          example: 'Hard work helps us achieve our goals.',
        },
      ],
    },
    {
      id: 's38',
      title: 'Từ vựng: Miêu tả công việc',
      subtitle: 'Tính từ giúp nhận xét nghề nghiệp rõ hơn.',
      layout: 'cards',
      cards: [
        {
          title: 'Positive',
          accent: 'green',
          content: 'interesting, meaningful, creative, suitable, flexible',
          example: 'Teaching is a meaningful job.',
        },
        {
          title: 'Difficult',
          accent: 'orange',
          content: 'challenging, stressful, demanding, competitive',
          example: 'The job market is competitive.',
        },
        {
          title: 'Money',
          accent: 'blue',
          content: 'well-paid',
          example: 'Many people want a well-paid job.',
        },
      ],
    },
    {
      id: 's39',
      title: 'Cấu trúc giao tiếp thường gặp',
      subtitle: 'Dùng để nói về nghề nghiệp tương lai.',
      layout: 'cards',
      cards: [
        {
          title: 'Nói nghề muốn làm',
          accent: 'green',
          content: 'I want to become + job + because + S + V.',
          example: 'I want to become a designer because I am creative.',
        },
        {
          title: 'Nói khó khăn nhưng quyết tâm',
          accent: 'orange',
          content: 'Although + S + V, S + V.',
          example: 'Although the job is difficult, I will try my best.',
        },
        {
          title: 'Nói mục đích',
          accent: 'blue',
          content: 'S + V + so that + S + can + V.',
          example: 'I study English so that I can work abroad.',
        },
      ],
    },
    {
      id: 's40',
      title: 'Tổng kết Unit 12',
      subtitle: 'My Future Career',
      layout: 'practice',
      accent: 'purple',
      sections: [
        {
          title: 'Concession',
          content: 'Although / Though / Even though + S + V, S + V.',
          example: 'Although the job is stressful, she loves it.',
        },
        {
          title: 'Result',
          content:
            'so + adj / adv + that; such + noun phrase + that; so that + S + can / could / will / would + V.',
          example: 'The course is so useful that many students join it.',
        },
        {
          title: 'Reason',
          content: 'Because / Since / As + S + V, S + V.',
          example: 'Because I enjoy coding, I want to become a software developer.',
        },
      ],
    },
  ],
};

export default deck;
