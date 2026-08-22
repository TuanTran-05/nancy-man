import hashlib
import os
import re
import shutil
import xml.etree.ElementTree as ET
import zipfile

W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
MARKUP_COMPATIBILITY_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
ET.register_namespace('w', W_NS)

SOURCE_EVAL_PATH = 'docs/assets/course-closing-templates/Nhan-Xet-Ket-Khoa-source-v1.docx'
SOURCE_TUITION_PATH = 'docs/assets/course-closing-templates/Thong-Bao-HP-source-v1.docx'

EXPECTED_EVAL_HASH = 'A1F45565B879BB00609BB06E89EEEE97E4B289B30A40917C02E520E0F1A2AF19'
EXPECTED_TUITION_HASH = '0BB08A44AD6FC1592953410559714D75A50A2DB164179DEAB28347B8CF1B39BF'

DEST_DIR = 'server/api/classes/records/templates'
PREPARED_EVAL_PATH = os.path.join(DEST_DIR, 'course-closing-evaluation-v1.docx')
PREPARED_TUITION_PATH = os.path.join(DEST_DIR, 'course-closing-tuition-v1.docx')

EVALUATION_CELL_SLOTS = {
    (3, 1): "student_name",
    (4, 1): "class_name",
    (7, 1): "attendance_score",
    (8, 1): "effort_score",
    (8, 4): "midterm_date",
    (8, 5): "midterm_score",
    (9, 1): "pronunciation_score",
    (9, 4): "final_date",
    (9, 5): "final_score",
    (10, 1): "homework_score",
    (10, 4): "total_score",
    (11, 1): "behavior_score",
    (13, 1): "classification",
}

TUITION_PARAGRAPH_SLOTS = {
    6: "tuition_greeting",
    9: "tuition_course_period",
    10: "tuition_exam_result",
    11: "tuition_next_course",
    13: "tuition_notice_date",
}


def get_sha256(filepath):
    h = hashlib.sha256()
    with open(filepath, 'rb') as f:
        while chunk := f.read(8192):
            h.update(chunk)
    return h.hexdigest().upper()


def normalize_ignorable_prefixes(xml_bytes):
    xml = xml_bytes.decode('utf-8')
    root_match = re.search(r'<w:document\b[^>]*>', xml)
    if root_match is None:
        raise ValueError('Prepared template is missing the w:document root')

    root = root_match.group(0)
    declarations = dict(
        re.findall(r'\sxmlns:([A-Za-z_][\w.-]*)="([^"]+)"', root)
    )
    compatibility_prefixes = [
        prefix
        for prefix, namespace in declarations.items()
        if namespace == MARKUP_COMPATIBILITY_NS
    ]
    if not compatibility_prefixes:
        return xml_bytes

    compatibility_group = '|'.join(re.escape(prefix) for prefix in compatibility_prefixes)
    ignorable_pattern = re.compile(
        rf'\s+(?:{compatibility_group}):Ignorable="([^"]*)"'
    )
    ignorable_values = ignorable_pattern.findall(root)
    if not ignorable_values:
        return xml_bytes

    merged_prefixes = list(
        dict.fromkeys(
            prefix
            for value in ignorable_values
            for prefix in value.split()
            if prefix in declarations
        )
    )
    normalized_root = ignorable_pattern.sub('', root)
    if merged_prefixes:
        preferred_prefix = (
            'mc' if 'mc' in compatibility_prefixes else compatibility_prefixes[0]
        )
        normalized_root = normalized_root[:-1] + (
            f' {preferred_prefix}:Ignorable="{" ".join(merged_prefixes)}">'
        )

    return xml.replace(root, normalized_root, 1).encode('utf-8')


def prepare_evaluation_xml(xml_bytes):
    tree = ET.fromstring(xml_bytes)
    body = tree.find(f'{{{W_NS}}}body')
    table = body.find(f'{{{W_NS}}}tbl')
    rows = table.findall(f'{{{W_NS}}}tr')

    for (r_idx, c_idx), slot_name in EVALUATION_CELL_SLOTS.items():
        row = rows[r_idx]
        cells = row.findall(f'{{{W_NS}}}tc')
        cell = cells[c_idx]

        # Find or create paragraph in cell
        p = cell.find(f'{{{W_NS}}}p')
        if p is None:
            p = ET.SubElement(cell, f'{{{W_NS}}}p')
        
        # Clear existing text runs in paragraph, retain pPr if any
        p_pr = p.find(f'{{{W_NS}}}pPr')
        for child in list(p):
            if child.tag != f'{{{W_NS}}}pPr':
                p.remove(child)

        r = ET.SubElement(p, f'{{{W_NS}}}r')
        t = ET.SubElement(r, f'{{{W_NS}}}t')
        t.text = f'{{{{{slot_name}}}}}'

    # Append {{teacher_comments}} as a new paragraph inside row 18 cell 0
    row_18_cell_0 = rows[18].findall(f'{{{W_NS}}}tc')[0]
    p_comments = ET.SubElement(row_18_cell_0, f'{{{W_NS}}}p')
    r_comments = ET.SubElement(p_comments, f'{{{W_NS}}}r')
    t_comments = ET.SubElement(r_comments, f'{{{W_NS}}}t')
    t_comments.text = '{{teacher_comments}}'

    # Append {{teacher_name}} to the existing row 19 cell 0 paragraph
    row_19_cell_0 = rows[19].findall(f'{{{W_NS}}}tc')[0]
    p_teacher = row_19_cell_0.find(f'{{{W_NS}}}p')
    if p_teacher is None:
        p_teacher = ET.SubElement(row_19_cell_0, f'{{{W_NS}}}p')
    r_teacher = ET.SubElement(p_teacher, f'{{{W_NS}}}r')
    t_teacher = ET.SubElement(r_teacher, f'{{{W_NS}}}t')
    t_teacher.text = '{{teacher_name}}'

    return normalize_ignorable_prefixes(
        ET.tostring(tree, encoding='utf-8', xml_declaration=True)
    )


def prepare_tuition_xml(xml_bytes):
    tree = ET.fromstring(xml_bytes)
    body = tree.find(f'{{{W_NS}}}body')
    paragraphs = body.findall(f'{{{W_NS}}}p')

    for p_idx, slot_name in TUITION_PARAGRAPH_SLOTS.items():
        p = paragraphs[p_idx]
        
        # Keep pPr and first rPr if present
        p_pr = p.find(f'{{{W_NS}}}pPr')
        first_r = p.find(f'{{{W_NS}}}r')
        r_pr = first_r.find(f'{{{W_NS}}}rPr') if first_r is not None else None

        for child in list(p):
            if child.tag != f'{{{W_NS}}}pPr':
                p.remove(child)

        r = ET.SubElement(p, f'{{{W_NS}}}r')
        if r_pr is not None:
            r.append(r_pr)
        t = ET.SubElement(r, f'{{{W_NS}}}t')
        t.text = f'{{{{{slot_name}}}}}'

    return normalize_ignorable_prefixes(
        ET.tostring(tree, encoding='utf-8', xml_declaration=True)
    )


def patch_docx(src_path, dest_path, xml_modifier_fn):
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    with zipfile.ZipFile(src_path, 'r') as src_zip:
        with zipfile.ZipFile(dest_path, 'w', compression=zipfile.ZIP_DEFLATED) as dest_zip:
            for item in src_zip.infolist():
                data = src_zip.read(item.filename)
                if item.filename == 'word/document.xml':
                    data = xml_modifier_fn(data)
                dest_zip.writestr(item, data)


def main():
    print("Verifying source template hashes...")
    eval_hash = get_sha256(SOURCE_EVAL_PATH)
    tuition_hash = get_sha256(SOURCE_TUITION_PATH)

    if eval_hash != EXPECTED_EVAL_HASH:
        raise ValueError(f"Evaluation source hash mismatch: {eval_hash} != {EXPECTED_EVAL_HASH}")
    if tuition_hash != EXPECTED_TUITION_HASH:
        raise ValueError(f"Tuition source hash mismatch: {tuition_hash} != {EXPECTED_TUITION_HASH}")

    print("Preparing evaluation template...")
    patch_docx(SOURCE_EVAL_PATH, PREPARED_EVAL_PATH, prepare_evaluation_xml)

    print("Preparing tuition template...")
    patch_docx(SOURCE_TUITION_PATH, PREPARED_TUITION_PATH, prepare_tuition_xml)

    print("Templates prepared successfully!")


if __name__ == '__main__':
    main()
