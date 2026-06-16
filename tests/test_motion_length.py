import server.camera_lab_server as s

def test_align_4k1_rounds_down_to_valid_length():
    assert s.align_4k1(90) == 89      # largest <= 90 with (n-1) % 4 == 0
    assert s.align_4k1(49) == 49
    assert s.align_4k1(50) == 49
    assert s.align_4k1(1) == 1

def test_align_4k1_minimum_is_1():
    assert s.align_4k1(0) == 1
    assert s.align_4k1(-5) == 1
