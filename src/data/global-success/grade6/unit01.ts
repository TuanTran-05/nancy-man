import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g6-u1-introduction',
  curriculumFamily: 'global-success',
  grade: 6,
  unitNumber: 1,
  title: 'Grammar Grade 6 - Unit 1: My New School',
  description: 'Bài giảng web-native theo mẫu pastel: play/do/have/study và Present Simple.',
  createdAt: '2026-05-15T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 6',
      subtitle: 'UNIT 1: MY NEW SCHOOL',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'PLAY, DO, HAVE, STUDY',
          subtitle: '(Các động từ thông dụng)',
          accent: 'orange',
        },
        {
          title: 'PRESENT SIMPLE',
          subtitle: '(Thì hiện tại đơn)',
          accent: 'pink',
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
            { text: 'Sử dụng đúng các động từ ' },
            { text: 'play, do, have, study', accent: 'blue', bold: true },
            { text: ' trong các ngữ cảnh khác nhau' },
          ],
        },
        {
          content: [
            { text: 'Nắm vững cấu trúc và cách dùng ' },
            { text: 'Thì hiện tại đơn (Present Simple)', accent: 'pink', bold: true },
          ],
        },
        {
          content: [
            { text: 'Biết quy tắc thêm ' },
            { text: 's/es', accent: 'green', bold: true },
            { text: ' vào động từ' },
          ],
        },
        {
          content: [
            { text: 'Áp dụng ' },
            { text: 'trạng từ tần suất', accent: 'orange', bold: true },
            { text: ' vào câu' },
          ],
        },
      ],
    },
    {
      id: 's3',
      title: 'PLAY, DO, HAVE, STUDY',
      subtitle: 'Cách sử dụng các động từ phổ biến',
      label: 'Phần 1',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'Play, Do, Have, Study',
      layout: 'cards',
      accent: 'blue',
      cards: [
        {
          title: 'PLAY',
          accent: 'red',
          bullets: [
            [{ text: 'Thể thao có ' }, { text: 'bóng / dụng cụ', bold: true }],
            [{ text: 'Chơi ' }, { text: 'nhạc cụ', bold: true }],
          ],
          example: 'play football, play the guitar',
        },
        {
          title: 'DO',
          accent: 'blue',
          bullets: [
            [{ text: 'Thể thao ' }, { text: 'không bóng', bold: true }, { text: ' / Cá nhân' }],
            'Võ thuật (judo, karate)',
            'Làm bài tập / việc nhà',
          ],
          example: 'do yoga, do homework',
        },
        {
          title: 'HAVE',
          accent: 'green',
          bullets: [
            [{ text: 'Ăn uống', bold: true }, { text: ' (meals)' }],
            [{ text: 'Sở hữu', bold: true }, { text: ' (possession)' }],
            [{ text: 'Trải nghiệm', bold: true }, { text: ' (experience)' }],
          ],
          example: 'have breakfast, have a lesson',
        },
        {
          title: 'STUDY',
          accent: 'purple',
          bullets: [
            [{ text: 'Học các ' }, { text: 'môn học', bold: true }],
            'Nghiên cứu chuyên sâu',
          ],
          example: 'study English, study physics',
        },
      ],
    },
    {
      id: 's5',
      title: 'Luyện nhanh',
      subtitle: 'Chọn play, do, have hoặc study để hoàn thành cụm từ.',
      layout: 'practice',
      accent: 'green',
      bullets: [
        { content: '_____ breakfast before school' },
        { content: '_____ football after class' },
        { content: '_____ homework in the evening' },
        { content: '_____ English on Monday' },
      ],
      examples: ['have breakfast', 'play football', 'do homework', 'study English'],
    },
    {
      id: 's6',
      title: 'PRESENT SIMPLE',
      subtitle: 'Thì hiện tại đơn',
      label: 'Phần 2',
      layout: 'section-cover',
      accent: 'pink',
    },
    {
      id: 's7',
      title: 'Present Simple: Cấu trúc cơ bản',
      subtitle: 'Dùng để nói về thói quen, sự thật hiển nhiên và lịch trình.',
      layout: 'explain',
      accent: 'pink',
      sections: [
        {
          title: 'Khẳng định',
          accent: 'green',
          content: [
            { text: 'I/You/We/They + ' },
            { text: 'V', bold: true, accent: 'green' },
            { text: ' | He/She/It + ' },
            { text: 'V-s/es', bold: true, accent: 'green' },
          ],
          example: 'She studies English every day.',
        },
        {
          title: 'Phủ định',
          accent: 'red',
          content: [
            { text: 'S + ' },
            { text: 'do/does not', bold: true, accent: 'red' },
            { text: ' + V nguyên mẫu' },
          ],
          example: 'He does not play football.',
        },
        {
          title: 'Nghi vấn',
          accent: 'blue',
          content: [
            { text: 'Do/Does + S + ' },
            { text: 'V nguyên mẫu', bold: true, accent: 'blue' },
            { text: '?' },
          ],
          example: 'Do you have English today?',
        },
        {
          title: 'Câu trả lời ngắn',
          accent: 'purple',
          bullets: ['Yes, I do. / No, I do not.', 'Yes, she does. / No, she does not.'],
        },
      ],
    },
    {
      id: 's8',
      title: 'Quy tắc thêm s/es',
      subtitle: 'Áp dụng với chủ ngữ He/She/It trong câu khẳng định.',
      layout: 'explain',
      accent: 'green',
      sections: [
        {
          title: 'Thêm -s',
          accent: 'green',
          content: 'Đa số động từ chỉ cần thêm s.',
          example: 'play -> plays, read -> reads',
        },
        {
          title: 'Thêm -es',
          accent: 'orange',
          content: 'Động từ kết thúc bằng o, ch, sh, ss, x thêm es.',
          example: 'go -> goes, watch -> watches',
        },
        {
          title: 'Đổi y thành ies',
          accent: 'pink',
          content: 'Phụ âm + y: bỏ y rồi thêm ies.',
          example: 'study -> studies',
        },
        {
          title: 'Giữ nguyên y',
          accent: 'blue',
          content: 'Nguyên âm + y: chỉ thêm s.',
          example: 'play -> plays',
        },
      ],
    },
    {
      id: 's9',
      title: 'Trạng từ tần suất',
      subtitle: 'Đặt trước động từ thường, sau động từ to be.',
      layout: 'cards',
      accent: 'orange',
      cards: [
        {
          title: 'Always',
          accent: 'red',
          content: 'Luôn luôn',
          example: 'I always do my homework.',
        },
        {
          title: 'Usually',
          accent: 'orange',
          content: 'Thường xuyên',
          example: 'She usually studies English.',
        },
        {
          title: 'Sometimes',
          accent: 'blue',
          content: 'Thỉnh thoảng',
          example: 'We sometimes play badminton.',
        },
        {
          title: 'Never',
          accent: 'purple',
          content: 'Không bao giờ',
          example: 'He never goes to school late.',
        },
      ],
    },
    {
      id: 's10',
      title: 'Practice',
      subtitle: 'Hoàn thành câu với dạng đúng của động từ trong ngoặc.',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'My sister _____ English every day. (study)' },
        { content: 'Nam _____ football after school. (play)' },
        { content: 'We _____ homework in the evening. (do)' },
        { content: 'She usually _____ breakfast at 6:30. (have)' },
      ],
      examples: ['studies', 'plays', 'do', 'has'],
    },
  ],
};

export default deck;
