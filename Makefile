.PHONY: check-all install-all demo-common
check-all:
	python3 common/check-all.py
install-all:
	@for kit in aqua uniswap world ens sui curvegrid; do $(MAKE) -C $$kit install || exit $$?; done
demo-common:
	$(MAKE) -C common demo
