.PHONY: test demo check-all
test:
	python3 serial.py python3 -m unittest discover -s tests -v
	python3 serial.py python3 validate_receipts.py
demo:
	python3 serial.py python3 demo.py
check-all:
	python3 check-all.py
