from setuptools import find_packages, setup


setup(
	name="approval_center",
	version="0.0.1",
	description="Approval Center",
	author="Suman Roy",
	author_email="sumanr619@gmail.com",
	packages=find_packages(),
	zip_safe=False,
	include_package_data=True,
	install_requires=["frappe"],
)
