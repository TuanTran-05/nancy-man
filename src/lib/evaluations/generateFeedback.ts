import type { Evaluation } from '../../types';
import { EVALUATION_COMMENT_LIMITS } from './commentLimits';

type EvaluationHistoryInput = Evaluation | Evaluation[] | null | undefined;

function formatEvaluationType(type: Evaluation['evaluationType']) {
  return type === 'final' ? 'Cuối khóa' : 'Giữa khóa';
}

function formatOptionalScore(value: number | string | undefined | null) {
  return value === undefined || value === null || value === '' ? 'Không có' : String(value);
}

function formatPositivePoints(points: string[] | undefined) {
  const text = Array.isArray(points) ? points.filter(Boolean).join(' | ') : '';
  return text || 'Không có';
}

function getRecentEvaluationHistory(input: EvaluationHistoryInput) {
  const evaluations = Array.isArray(input) ? input : input ? [input] : [];
  return evaluations.slice(0, 3);
}

function getEvaluationHistoryText(input: EvaluationHistoryInput) {
  const recentEvaluations = getRecentEvaluationHistory(input);
  if (recentEvaluations.length === 0) return '';

  const historyItems = recentEvaluations
    .map(
      (evaluation, index) => `
        Đánh giá gần nhất #${index + 1}:
        - Ngày: ${evaluation.date || 'Không có'}
        - Loại đánh giá: ${formatEvaluationType(evaluation.evaluationType)}
        - Điểm tổng: ${formatOptionalScore(evaluation.totalScore)}
        - Điểm thi cuối khóa: ${formatOptionalScore(evaluation.finalScore)}
        - Điểm Chuyên cần: ${formatOptionalScore(evaluation.scores.attendance)}%
        - Điểm Đóng góp: ${formatOptionalScore(evaluation.scores.effort)}%
        - Điểm Phát âm: ${formatOptionalScore(evaluation.scores.pronunciation)}%
        - Điểm Bài tập: ${formatOptionalScore(evaluation.scores.homework)}%
        - Điểm Tác phong: ${formatOptionalScore(evaluation.scores.behavior)}%
        - Nhận xét điểm mạnh cũ: ${formatPositivePoints(evaluation.positivePoints)}
        - Nhận xét cần cải thiện cũ: ${evaluation.improvementPoints || 'Không có'}`
    )
    .join('\n');

  return `
        Lịch sử tối đa 3 đánh giá gần nhất của học sinh này (dùng để nhận diện xu hướng, không chép lại máy móc):
        ${historyItems}
        
        YÊU CẦU DỰA TRÊN LỊCH SỬ:
        - Trước khi chọn câu mẫu, hãy so sánh điểm hiện tại với lịch sử để nhận ra xu hướng.
        - Nếu một điểm cần cải thiện lặp lại qua các đánh giá cũ và điểm hiện tại vẫn chưa cao, hãy ưu tiên chọn câu nhắc nhở tương ứng.
        - Nếu nhận xét cũ nêu một điểm yếu nhưng điểm hiện tại đã tốt hơn rõ rệt, hãy khen sự tiến bộ bằng câu mẫu phù hợp.
        - Không lặp nguyên văn nhận xét cũ nếu tình hình hiện tại đã khác; chỉ dùng lịch sử để chọn câu phù hợp.
        `;
}

export function getFeedbackPrompt(
  studentName: string,
  absences: number,
  scores: Record<string, string | number>,
  finalScore?: string | number,
  previousEvaluations?: EvaluationHistoryInput
): string {
  const evaluationHistoryText = getEvaluationHistoryText(previousEvaluations);

  return `
        Bạn là một giáo viên tiếng Anh. Dựa vào các điểm số và thông tin sau của học sinh, hãy viết một đoạn nhận xét cuối khóa.
        LUẬT TỐI THƯỢNG: BẠN CHỈ ĐƯỢC PHÉP SỬ DỤNG CÁC CÂU VĂN TRONG DANH SÁCH MẪU DƯỚI ĐÂY. KHÔNG ĐƯỢC TỰ SÁNG TẠO THÊM TỪ NGỮ HAY CÂU VĂN KHÁC. Hãy chọn lọc và ghép các câu mẫu lại cho phù hợp với điểm số.
        
        Thông tin học sinh (Khóa hiện tại):
        - Tên: ${studentName}
        - Số buổi vắng: ${absences}
        - Điểm Chuyên cần: ${scores.attendance}%
        - Điểm Đóng góp xây dựng bài: ${scores.effort}%
        - Điểm Phát âm: ${scores.pronunciation}%
        - Điểm Bài tập về nhà: ${scores.homework}%
        - Điểm Tác phong: ${scores.behavior}%
        ${finalScore ? `- Điểm thi cuối khóa: ${finalScore}` : ''}

        ${evaluationHistoryText}

        DANH SÁCH CÂU MẪU CHO ĐIỂM MẠNH (Chọn 2-4 câu ngắn, phù hợp nhất với điểm cao, sao cho tổng positivePoints không quá ${EVALUATION_COMMENT_LIMITS.good} ký tự):
        - Học tập trung, tích cực phát biểu và đóng góp ý kiến cho buổi học.
        - Ngoan, hòa đồng, năng động.
        - Luôn hoàn thành bài tập được giao.
        - Tiếp thu nhanh và nhớ bài tốt.
        - Có sự cố gắng trong học tập.
        - Có tinh thần học hỏi, tiếp thu tốt kiến thức.
        - Tham gia tốt các hoạt động trong lớp.
        - Hòa đồng và hợp tác tốt với các bạn.
        - Phát âm to, rõ ràng.
        - Học giỏi, nhớ bài cũ tốt và tiếp thu bài nhanh.
        - Bé rất ngoan, năng động, đi học đầy đủ và đúng giờ.
        - Các kỹ năng nghe, phát âm và từ vựng đều ở mức khá, đồng thời có sự cẩn thận trong lúc đặt câu.
        - Có sự tiến bộ rõ rệt so với các khóa trước.
        - Những điểm cần cải thiện ở khóa trước đã được cải thiện tốt hơn.

        DANH SÁCH CÂU MẪU CHO ĐIỂM CẦN CẢI THIỆN (Chọn 1 câu phù hợp nhất với điểm thấp, sao cho tổng improvementPoints không quá ${EVALUATION_COMMENT_LIMITS.bad} ký tự và bắt đầu bằng "Tuy nhiên: "):
        - Tuy nhiên: Cố gắng cẩn thận hơn phần writing để tránh những lỗi không cần thiết.
        - Tuy nhiên: Thường xuyên nghỉ học và chưa hoàn thành các bài tập thầy giao về nhà. Trong giờ học còn hay giỡn và mất tập trung. Ngữ pháp và từ vựng cũng còn hơi hạn chế, áp dụng công thức còn sai. Chưa thật sự tích cực trong học tập.
        - Tuy nhiên: Ngữ pháp và từ vựng còn hạn chế. Cố gắng ôn bài và làm bài tập thường xuyên hơn để nắm vững các cấu trúc ngữ pháp căn bản. Thỉnh thoảng vẫn còn nói chuyện nhiều và không chú ý bài.
        - Tuy nhiên: Chưa ôn bài cũ. Phần thi viết gần như bỏ trắng. Ngữ pháp và từ vựng cũng còn hơi hạn chế, áp dụng công thức còn sai. Cố gắng thường xuyên ôn bài và học bài sau buổi học tại nhà để nắm chắc bài hơn.
        - Tuy nhiên: Phần ngữ pháp còn sai nhiều và hay quên các cấu trúc câu cơ bản. Cố gắng thường xuyên ôn bài và làm bài tập để củng cố kiến thức. Chú ý phần writing nhiều hơn nhé.
        - Tuy nhiên: Hay quên làm bài tập về nhà thầy đã giao. Ngữ pháp và từ vựng còn hạn chế, cố gắng làm bài tập và ôn bài để nắm chắc kiến thức đã học. Đặc biệt là bài thi phần writing gần như bỏ trống.
        - Tuy nhiên: Chú ý nhiều hơn phần writing, khi viết phải theo cấu trúc của 1 đoạn văn. Cố gắng ôn bài nhiều hơn để nắm chắc ngữ pháp.
        - Tuy nhiên: Trong giờ học còn hay giỡn và mất tập trung. Ngữ pháp và từ vựng cũng còn hơi hạn chế, áp dụng công thức còn sai. Hay quên làm bài tập về nhà thầy giao. Cố gắng ôn bài và học bài sau buổi học tại nhà để nắm chắc bài hơn. Phần bài thi writing gần như bỏ trống. Cố gắng tích cực trong học tập nhiều hơn.
        - Tuy nhiên: Học tốt nhưng cố gắng chú ý bài làm của mình hơn để tránh những lỗi nhỏ không đáng có. Đặc biệt là phần grammar.
        - Tuy nhiên: Chú ý phần grammar nhiều hơn đặc biệt là phần collocation (những giới từ buộc phải theo sau một động từ là gì).
        - Tuy nhiên: Cố gắng tích cực hơn nữa trong học bài và ôn bài. Phần thi writing gần như bỏ trống, ngữ pháp còn sai nhiều dù là những câu cơ bản đã sửa nhiều lần. Cố gắng làm bài tập ở nhà nhiều hơn để nắm chắc kiến thức.
        - Tuy nhiên: Còn sai nhiều ở phần ngữ pháp. Khi sửa bài cố gắng note lại những ý mà thầy chữa bài chứ không nên ghi mỗi đáp án. Cố gắng tích cực hơn trong mỗi buổi học. Thường xuyên làm bài tập sau mỗi bữa học để nắm chắc bài học nhé.
        - Tuy nhiên: Trong lớp còn hơi rụt rè, ít phát biểu ý kiến. Cố gắng tích cực hơn trong lớp học như là: giơ tay phát biểu, giơ tay lên bảng sửa bài,…Chú ý viết đúng cấu trúc của một bài writing.
        - Tuy nhiên: Thi thoảng hay nói chuyện với bạn và không chú ý bài học. Chú ý tập trung học hơn.
        - Tuy nhiên: Dễ quên kiến thức cũ nên cần ôn bài thường xuyên hơn để nắm chắc các từ vựng và cấu trúc câu.
        - Tuy nhiên: Phần nói còn cần cải thiện hơn nữa. Cố gắng đọc bài nhiều hơn ở nhà để trôi chảy hơn.
        - Tuy nhiên: Cố gắng tích cực hơn trong buổi học như: giơ tay phát biểu nhiều hơn, xung phong lên bảng làm bài,…
        - Tuy nhiên: Còn hay quên làm bài tập. Phát âm còn hơi bị dính chữ, và nhỏ. Bé phát biểu khá ít, nên cố gắng tích cực phát biểu đóng góp xây dựng bài học hơn. Cố gắng ôn thêm từ vựng ở nhà và luyện đọc bằng các mẫu câu đơn giản trong sách.
        - Tuy nhiên: Về phần ngữ pháp, con cần cố gắng luyện tập nhiều hơn để nắm vững các cấu trúc câu đã học. Bên cạnh đó, bé nên dành thêm thời gian rèn luyện để cải thiện thêm kỹ năng đọc của mình.
        - Tuy nhiên: Đôi lúc còn gây mất trật tự, con cần cố gắng tập trung hơn trong giờ học. Bé cần dành thời gian ôn tập từ vựng nhiều hơn và tập trung vào phần ngữ pháp để củng cố kiến thức.
        - Tuy nhiên: Đôi lúc còn gây mất trật tự và hay tự ý ra khỏi chỗ dù đã được nhắc nhở nhiều lần. Con cần tập trung nghe giảng hơn để nắm vững các cấu trúc câu và dành thời gian ôn tập ngữ pháp cũng như từ vựng để cải thiện kỹ năng đọc. Ngoài ra, bé nên cố gắng tự tin hơn khi nói trước lớp.
        - Tuy nhiên: Bé vẫn còn hay quên chia thì cho động từ. Con nên dành thời gian ôn tập kỹ hơn nội dung này để hoàn thiện kiến thức.
        - Tuy nhiên: Còn ít giơ tay phát biểu, nên cố gắng tích cực đóng góp xây dựng bài hơn sẽ tốt hơn. Con cần tiếp tục duy trì và phát huy những điểm mạnh hiện có.
        - Tuy nhiên: Cần chú ý sử dụng đúng các công thức đã được học trên lớp. Cố gắng phát huy tốt những điểm mạnh hơn nữa.

        Yêu cầu định dạng đầu ra (chỉ trả về JSON hợp lệ, không có markdown formatting):
        - Mỗi giá trị của positivePoints và improvementPoints tối đa ${EVALUATION_COMMENT_LIMITS.good} ký tự.
        - Không viết câu bị lửng hoặc bị cắt giữa chừng. Nếu gần vượt giới hạn, hãy chọn ít câu mẫu hơn.
        - Escape mọi xuống dòng trong chuỗi bằng \\n. Không đặt xuống dòng thật bên trong giá trị chuỗi JSON.
        - Không thêm dấu phẩy sau thuộc tính cuối cùng.
        {
          "positivePoints": "Các điểm mạnh (tối đa ${EVALUATION_COMMENT_LIMITS.good} ký tự, mỗi ý một dòng, không cần ký tự gạch đầu dòng vì hệ thống tự thêm, cách nhau bằng dấu \\n)",
          "improvementPoints": "Những điểm cần cải thiện (tối đa ${EVALUATION_COMMENT_LIMITS.bad} ký tự, bắt đầu bằng 'Tuy nhiên: ')"
        }
      `;
}
